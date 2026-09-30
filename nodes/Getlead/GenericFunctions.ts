import {
	NodeApiError,
	sleep,
	type IDataObject,
	type IExecuteFunctions,
	type IHttpRequestMethods,
	type IHttpRequestOptions,
	type ILoadOptionsFunctions,
	type INodeListSearchResult,
	type INodePropertyOptions,
	type IPollFunctions,
	type ResourceMapperField,
	type ResourceMapperFields,
	type JsonObject,
} from 'n8n-workflow';

type GetleadContext = IExecuteFunctions | ILoadOptionsFunctions | IPollFunctions;

export interface GetleadResponse {
	statusCode: number;
	body: IDataObject;
	headers: IDataObject;
}

const DEFAULT_BASE_URL = 'https://v3.getleadcrm.com/api/v1';
const MAX_RETRIES = 3;
// Never block an execution longer than this on a single 429.
const MAX_RETRY_AFTER_SECONDS = 120;
const LIST_PAGE_SIZE = 50;

/**
 * Seconds to wait before retrying a 429. Getlead returns `retry_after` in the body
 * (`{"message": "...", "retry_after": 60}`); fall back to the Retry-After header.
 */
function getRetryAfterSeconds(response: GetleadResponse): number {
	const body = response.body ?? {};
	const error = (body.error as IDataObject | undefined) ?? {};
	const context = (error.context as IDataObject | undefined) ?? {};
	const candidates = [body.retry_after, context.retry_after, response.headers?.['retry-after']];
	for (const value of candidates) {
		const seconds = Number(value);
		if (Number.isFinite(seconds) && seconds >= 0) return seconds;
	}
	return 60;
}

function getErrorMessage(body: IDataObject): string | undefined {
	const error = body?.error as IDataObject | undefined;
	return (error?.message as string | undefined) ?? (body?.message as string | undefined);
}

/**
 * Makes an authenticated request to the Getlead V3 API.
 * Retries 429s after `retry_after` seconds and 5xx errors with exponential backoff.
 * Pass `allowedStatusCodes` to receive those error responses instead of throwing (e.g. 404 for upsert).
 */
export async function getleadApiRequest(
	this: GetleadContext,
	method: IHttpRequestMethods,
	endpoint: string,
	body?: IDataObject,
	qs: IDataObject = {},
	allowedStatusCodes: number[] = [],
): Promise<GetleadResponse> {
	const credentials = await this.getCredentials('getleadApi');
	const baseUrl = ((credentials.baseUrl as string) || DEFAULT_BASE_URL).replace(/\/+$/, '');

	const options: IHttpRequestOptions = {
		method,
		url: `${baseUrl}${endpoint}`,
		qs,
		body,
		json: true,
		arrayFormat: 'brackets',
		headers: { Accept: 'application/json' },
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};
	if (!body || Object.keys(body).length === 0) delete options.body;

	for (let attempt = 0; ; attempt++) {
		const response = (await this.helpers.httpRequestWithAuthentication.call(
			this,
			'getleadApi',
			options,
		)) as GetleadResponse;
		const { statusCode } = response;
		const responseBody = (typeof response.body === 'object' && response.body) || {};

		if (statusCode < 400 || allowedStatusCodes.includes(statusCode)) {
			return { ...response, body: responseBody };
		}

		if (statusCode === 429 && attempt < MAX_RETRIES) {
			const waitSeconds = getRetryAfterSeconds({ ...response, body: responseBody });
			if (waitSeconds <= MAX_RETRY_AFTER_SECONDS) {
				await sleep(waitSeconds * 1000);
				continue;
			}
		}

		if (statusCode >= 500 && attempt < MAX_RETRIES) {
			await sleep(2 ** attempt * 1000);
			continue;
		}

		throw new NodeApiError(this.getNode(), responseBody as JsonObject, {
			httpCode: String(statusCode),
			message: getErrorMessage(responseBody) ?? `Getlead API request failed (${statusCode})`,
			description: (responseBody.error as IDataObject | undefined)?.code as string | undefined,
		});
	}
}

/** Unwraps `{ data: ... }` envelopes. */
export function unwrapData(body: IDataObject): IDataObject {
	const data = body?.data;
	return data && typeof data === 'object' && !Array.isArray(data) ? (data as IDataObject) : body;
}

/** Extracts the list of leads from a `GET /leads` response. */
export function extractList(body: IDataObject): IDataObject[] {
	if (Array.isArray(body?.data)) return body.data as IDataObject[];
	const data = unwrapData(body);
	for (const key of ['leads', 'data', 'items']) {
		if (Array.isArray(data[key])) return data[key] as IDataObject[];
	}
	return [];
}

/** Extracts the next-page cursor from a cursor-paginated response, if any. */
export function extractNextCursor(body: IDataObject): string | undefined {
	const meta = (body?.meta as IDataObject | undefined) ?? {};
	const pagination =
		(body?.pagination as IDataObject | undefined) ??
		(meta.pagination as IDataObject | undefined) ??
		{};
	const cursor = meta.next_cursor ?? body?.next_cursor ?? pagination.next_cursor;
	if (cursor) return String(cursor);

	const nextLink = (body?.links as IDataObject | undefined)?.next ?? meta.next_page_url;
	if (typeof nextLink === 'string' && nextLink) {
		const match = /[?&]cursor=([^&]+)/.exec(nextLink);
		if (match) return decodeURIComponent(match[1]);
	}
	return undefined;
}

export function getLeadId(lead: IDataObject): string | undefined {
	const id = lead.id ?? lead.lead_id ?? lead.uuid;
	return id === undefined || id === null ? undefined : String(id);
}

/**
 * Fetches leads from `GET /leads`, following cursors until `limit` items (or `maxPages` pages) are read.
 */
export async function getleadListLeads(
	this: GetleadContext,
	qs: IDataObject,
	limit?: number,
	maxPages = Infinity,
): Promise<IDataObject[]> {
	const leads: IDataObject[] = [];
	let cursor: string | undefined;
	let pages = 0;

	do {
		const perPage = limit ? Math.min(LIST_PAGE_SIZE, limit - leads.length) : LIST_PAGE_SIZE;
		const pageQs: IDataObject = { ...qs, per_page: perPage };
		if (cursor) pageQs.cursor = cursor;

		const { body } = await getleadApiRequest.call(this, 'GET', '/leads', undefined, pageQs);
		leads.push(...extractList(body));
		cursor = extractNextCursor(body);
		pages++;
	} while (cursor && (!limit || leads.length < limit) && pages < maxPages);

	return limit ? leads.slice(0, limit) : leads;
}

/** Returns the options for a dropdown from the first array found under `keys` in `GET /meta`. */
async function getMetaOptions(
	this: ILoadOptionsFunctions,
	keys: string[],
): Promise<INodePropertyOptions[]> {
	const { body } = await getleadApiRequest.call(this, 'GET', '/meta');
	const meta = unwrapData(body);
	const list = keys.map((key) => meta[key]).find(Array.isArray) as IDataObject[] | undefined;

	return (list ?? [])
		.map((item) => {
			const value = item.id ?? item.uuid ?? item.value ?? item.key;
			const name = item.name ?? item.title ?? item.label ?? item.full_name ?? item.email ?? value;
			return { name: String(name), value: String(value) };
		})
		.filter((option) => option.value !== 'undefined')
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** `pass_type` → `Pass Type` */
function humanize(key: string): string {
	return key.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Allowed values come as `[{ label, value }]` (or plain strings). */
function toFieldOptions(allowed: unknown): INodePropertyOptions[] {
	if (!Array.isArray(allowed)) return [];
	return allowed.map((option: IDataObject | string) =>
		typeof option === 'object'
			? { name: String(option.label ?? option.value), value: String(option.value ?? option.label) }
			: { name: String(option), value: String(option) },
	);
}

/**
 * Custom fields from `GET /meta` (`{ field_key, field_type, allowed_values }`) as resource-mapper
 * fields, so each gets a matching input: dropdown for select, toggle for boolean, date picker for datetime.
 * Fields start hidden; the user adds the ones they need.
 */
async function getCustomFieldMapping(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
	const { body } = await getleadApiRequest.call(this, 'GET', '/meta');
	const customFields = (unwrapData(body).custom_fields as IDataObject[] | undefined) ?? [];

	const fields = customFields
		.filter((field) => field.field_key)
		.map((field): ResourceMapperField => {
			const key = String(field.field_key);
			const label = String(field.label ?? field.name ?? humanize(key));
			const options = toFieldOptions(field.allowed_values);
			const base: ResourceMapperField = {
				id: key,
				displayName: label,
				required: false,
				defaultMatch: false,
				canBeUsedToMatch: false,
				display: true,
				removed: true,
				type: 'string',
			};

			switch (field.field_type) {
				case 'select':
					return { ...base, type: 'options', options };
				case 'multiselect':
					// The resource mapper has no multi-select widget; these use "Multi-Select Custom Fields".
					return { ...base, display: false, options };
				case 'boolean':
					return { ...base, type: 'boolean' };
				case 'date':
				case 'datetime':
					return { ...base, type: 'dateTime' };
				case 'number':
				case 'numeric':
				case 'integer':
					return { ...base, type: 'number' };
				case 'url':
					return { ...base, type: 'url' };
				// text, textarea, email, phone → text input
				default:
					return base;
			}
		})
		.sort((a, b) => a.displayName.localeCompare(b.displayName));

	return { fields, emptyFieldsNotice: 'No custom fields found in your Getlead account' };
}

export const resourceMapping = { getCustomFieldMapping };

async function getMultiSelectCustomFields(this: ILoadOptionsFunctions): Promise<IDataObject[]> {
	const { body } = await getleadApiRequest.call(this, 'GET', '/meta');
	const fields = (unwrapData(body).custom_fields as IDataObject[] | undefined) ?? [];
	return fields.filter((field) => field.field_key && field.field_type === 'multiselect');
}

function getPrimaryPhone(lead: IDataObject): string | undefined {
	const [first] = (lead.phone_numbers as Array<IDataObject | string> | undefined) ?? [];
	if (!first) return undefined;
	return typeof first === 'string' ? first : (first.number as string | undefined);
}

export const listSearch = {
	/** Lead picker: newest leads first, filtered by the search box. */
	async searchLeads(
		this: ILoadOptionsFunctions,
		filter?: string,
		paginationToken?: string,
	): Promise<INodeListSearchResult> {
		const qs: IDataObject = { sort_by: 'created_at', sort_direction: 'desc', per_page: 20 };
		if (filter) qs.search = filter;
		if (paginationToken) qs.cursor = paginationToken;

		const { body } = await getleadApiRequest.call(this, 'GET', '/leads', undefined, qs);
		const results = extractList(body)
			.map((lead) => {
				const id = getLeadId(lead);
				const label = [lead.name || 'Unnamed lead', getPrimaryPhone(lead) ?? lead.email]
					.filter(Boolean)
					.join(' · ');
				return { name: String(label), value: id ?? '' };
			})
			.filter((result) => result.value);

		return { results, paginationToken: extractNextCursor(body) };
	},
};

export const loadOptions = {
	async getStatuses(this: ILoadOptionsFunctions) {
		return await getMetaOptions.call(this, ['statuses', 'lead_statuses']);
	},
	async getSources(this: ILoadOptionsFunctions) {
		return await getMetaOptions.call(this, ['sources', 'lead_sources']);
	},
	async getUsers(this: ILoadOptionsFunctions) {
		return await getMetaOptions.call(this, ['agents', 'users', 'staff']);
	},
	async getPurposes(this: ILoadOptionsFunctions) {
		return await getMetaOptions.call(this, ['purposes', 'lead_purposes']);
	},
	async getMultiSelectFields(this: ILoadOptionsFunctions) {
		return (await getMultiSelectCustomFields.call(this))
			.map((field) => {
				const key = String(field.field_key);
				return { name: String(field.label ?? field.name ?? humanize(key)), value: key };
			})
			.sort((a, b) => a.name.localeCompare(b.name));
	},
	/** Values of the multi-select field chosen in the same row (`&key`). */
	async getMultiSelectValues(this: ILoadOptionsFunctions) {
		const key = this.getCurrentNodeParameter('&key') as string | undefined;
		if (!key) return [];
		const field = (await getMultiSelectCustomFields.call(this)).find((f) => f.field_key === key);
		return toFieldOptions(field?.allowed_values);
	},
};
