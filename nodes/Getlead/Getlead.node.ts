import {
	NodeApiError,
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type JsonObject,
	type ResourceMapperValue,
} from 'n8n-workflow';
import {
	leadFieldsDescription,
	leadOperations,
	noteFieldsDescription,
	noteOperations,
} from './descriptions';
import {
	getleadApiRequest,
	getleadListLeads,
	listSearch,
	loadOptions,
	resourceMapping,
	unwrapData,
} from './GenericFunctions';

function splitPhoneNumbers(value: string): string[] {
	return value
		.split(',')
		.map((phone) => phone.trim())
		.filter(Boolean);
}

/**
 * Getlead only accepts plain ISO 8601, and on create a date-only field accepts nothing but "2026-10-14".
 * n8n hands date fields over as "2026-10-14 00:00:00" or as a DateTime ("2026-10-14T00:00:00.000+05:30"):
 * keep the date (and, for date & time fields, the wall-clock time) the user picked; drop ms and offset.
 */
function toIsoDateTime(value: unknown, dateOnly: boolean): string {
	const text =
		value && typeof value === 'object' && 'toISO' in value
			? String((value as { toISO: () => string }).toISO())
			: String(value).trim();
	const match = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(:\d{2})?)?/.exec(text);
	if (!match) return text;
	const [, date, time, seconds] = match;
	return time && !dateOnly ? `${date}T${time}${seconds ?? ':00'}` : date;
}

/**
 * Keys of date-only custom fields, from `/meta`. n8n shows date and date & time fields with the same
 * picker, so the type is looked up only when a date value is actually being sent (once per execution).
 */
async function getDateOnlyKeys(
	this: IExecuteFunctions,
	itemIndex: number,
	cache: { keys?: Set<string> },
): Promise<Set<string>> {
	const mapper = this.getNodeParameter(
		'customFields',
		itemIndex,
		null,
	) as ResourceMapperValue | null;
	const values = mapper?.value ?? {};
	const hasDate = (mapper?.schema ?? []).some(
		(field) =>
			field.type === 'dateTime' &&
			values[field.id] !== null &&
			values[field.id] !== undefined &&
			values[field.id] !== '',
	);
	if (!hasDate) return new Set();
	if (!cache.keys) {
		const { body } = await getleadApiRequest.call(this, 'GET', '/meta');
		const fields = (unwrapData(body).custom_fields as IDataObject[] | undefined) ?? [];
		cache.keys = new Set(
			fields.filter((field) => field.field_type === 'date').map((field) => String(field.field_key)),
		);
	}
	return cache.keys;
}

/**
 * Reads the "Custom Fields" resource mapper into Getlead's `custom_fields` object.
 * Select values may be given by label or value (e.g. "KOTTAYAM" → "kottayam"); multiselect is
 * comma-separated. Anything not in the field's allowed values fails with the list of valid choices.
 */
function getCustomFields(
	this: IExecuteFunctions,
	itemIndex: number,
	dateOnlyKeys: Set<string>,
): IDataObject {
	const mapper = this.getNodeParameter(
		'customFields',
		itemIndex,
		null,
	) as ResourceMapperValue | null;
	const schema = new Map((mapper?.schema ?? []).map((field) => [field.id, field]));
	const customFields: IDataObject = {};

	for (const [key, value] of Object.entries(mapper?.value ?? {})) {
		if (value === null || value === undefined || value === '') continue;
		const field = schema.get(key);
		if (field?.type === 'dateTime') {
			customFields[key] = toIsoDateTime(value, dateOnlyKeys.has(key));
			continue;
		}
		const options = field?.options ?? [];
		if (!field || !options.length) {
			customFields[key] = value;
			continue;
		}

		const isSingle = field.type === 'options';
		const inputs = isSingle
			? [String(value)]
			: String(value)
					.split(',')
					.map((part) => part.trim())
					.filter(Boolean);
		const resolved = inputs.map((input) => {
			const needle = input.toLowerCase();
			const option = options.find(
				(o) => String(o.value).toLowerCase() === needle || o.name.toLowerCase() === needle,
			);
			if (!option) {
				throw new NodeOperationError(
					this.getNode(),
					`"${input}" is not an allowed value for custom field "${key}"`,
					{ itemIndex, description: `Allowed values: ${options.map((o) => o.name).join(', ')}` },
				);
			}
			return option.value;
		});
		customFields[key] = isSingle ? resolved[0] : resolved;
	}

	// "Multi-Select Custom Fields": { field: [{ key: 'hobbies', values: ['reading', 'music'] }] }
	const multiSelect = this.getNodeParameter('multiSelectFieldsUi', itemIndex, {}) as IDataObject;
	for (const row of (multiSelect.field as IDataObject[] | undefined) ?? []) {
		if (!row.key) continue;
		const values = row.values;
		const list = Array.isArray(values)
			? values
			: String(values ?? '')
					.split(',')
					.map((v) => v.trim())
					.filter(Boolean);
		if (!list.length) continue;
		// The same field picked in two rows: combine the values instead of letting the last row win.
		const previous = customFields[row.key as string];
		customFields[row.key as string] = Array.isArray(previous)
			? [...new Set([...previous, ...list])]
			: list;
	}
	return customFields;
}

/** Converts a node "fields" collection (plus Custom Fields) into a Getlead request body, dropping empty values. */
function buildLeadBody(
	this: IExecuteFunctions,
	fields: IDataObject,
	itemIndex: number,
	dateOnlyKeys: Set<string>,
): IDataObject {
	const body: IDataObject = {};
	for (const [key, value] of Object.entries(fields)) {
		if (value === '' || value === undefined || value === null) continue;
		if (Array.isArray(value) && value.length === 0) continue;

		if (key === 'phoneNumbers') {
			body.phone_numbers = splitPhoneNumbers(value as string);
		} else {
			body[key] = value;
		}
	}

	const customFields = getCustomFields.call(this, itemIndex, dateOnlyKeys);
	if (Object.keys(customFields).length) body.custom_fields = customFields;
	return body;
}

/**
 * Getlead replaces a lead's whole `custom_fields` set on PATCH, so merge in the lead's current
 * values first; otherwise updating one custom field would wipe the others.
 */
async function withExistingCustomFields(
	this: IExecuteFunctions,
	leadId: string,
	customFields: IDataObject,
): Promise<IDataObject> {
	const { body } = await getleadApiRequest.call(
		this,
		'GET',
		`/leads/${encodeURIComponent(leadId)}`,
	);
	const existing: IDataObject = {};
	for (const field of (unwrapData(body).custom_fields as IDataObject[] | undefined) ?? []) {
		if (field.field_key) existing[field.field_key as string] = field.value;
	}
	return { ...existing, ...customFields };
}

export class Getlead implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Getlead',
		name: 'getlead',
		icon: { light: 'file:../../icons/getlead.svg', dark: 'file:../../icons/getlead.dark.svg' },
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Create, update and find leads in Getlead CRM',
		defaults: {
			name: 'Getlead',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'getleadApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Lead', value: 'lead' },
					{ name: 'Note', value: 'note' },
				],
				default: 'lead',
			},
			...leadOperations,
			...leadFieldsDescription,
			...noteOperations,
			...noteFieldsDescription,
		],
	};

	methods = { loadOptions, listSearch, resourceMapping };

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const dateTypeCache: { keys?: Set<string> } = {};

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				let result: IDataObject | IDataObject[] = {};

				if (resource === 'lead' && operation === 'create') {
					const dateOnlyKeys = await getDateOnlyKeys.call(this, i, dateTypeCache);
					const body = buildLeadBody.call(
						this,
						{
							phoneNumbers: this.getNodeParameter('phoneNumbers', i) as string,
							name: this.getNodeParameter('name', i) as string,
							...(this.getNodeParameter('additionalFields', i) as IDataObject),
						},
						i,
						dateOnlyKeys,
					);
					const response = await getleadApiRequest.call(this, 'POST', '/leads', body);
					result = { ...unwrapData(response.body) };
				} else if (resource === 'lead' && operation === 'update') {
					const leadId = this.getNodeParameter('leadId', i, '', { extractValue: true }) as string;
					const dateOnlyKeys = await getDateOnlyKeys.call(this, i, dateTypeCache);
					const body = buildLeadBody.call(
						this,
						this.getNodeParameter('updateFields', i) as IDataObject,
						i,
						dateOnlyKeys,
					);
					if (!Object.keys(body).length) {
						throw new NodeOperationError(this.getNode(), 'Add at least one field to update', {
							itemIndex: i,
						});
					}
					if (body.custom_fields) {
						body.custom_fields = await withExistingCustomFields.call(
							this,
							leadId,
							body.custom_fields as IDataObject,
						);
					}
					// 204 No Content on success
					await getleadApiRequest.call(this, 'PATCH', `/leads/${encodeURIComponent(leadId)}`, body);
					result = { lead_id: leadId, updated: true };
				} else if (resource === 'lead' && operation === 'upsert') {
					const matchOn = this.getNodeParameter('matchOn', i) as string;
					const phoneNumber = (this.getNodeParameter('phoneNumber', i) as string).trim();
					const dateOnlyKeys = await getDateOnlyKeys.call(this, i, dateTypeCache);
					const fields = buildLeadBody.call(
						this,
						{
							name: this.getNodeParameter('name', i) as string,
							...(matchOn === 'email'
								? { email: this.getNodeParameter('email', i) as string }
								: {}),
							...(this.getNodeParameter('additionalFields', i) as IDataObject),
						},
						i,
						dateOnlyKeys,
					);
					const { email, ...updateFields } = fields;
					const identifier: IDataObject =
						matchOn === 'email' ? { email } : { phone_number: phoneNumber };
					// When matching on phone, email is a normal field to update.
					if (matchOn === 'phone' && email) updateFields.email = email;

					// Custom fields are applied separately on the update path (see withExistingCustomFields).
					const { custom_fields: customFields, ...standardFields } = updateFields;
					const updateResponse = await getleadApiRequest.call(
						this,
						'PATCH',
						'/leads/by-identifier',
						{ ...identifier, ...standardFields },
						{},
						[404],
					);

					if (updateResponse.statusCode === 404) {
						const createBody: IDataObject = { ...updateFields, phone_numbers: [phoneNumber] };
						if (email) createBody.email = email;
						const createResponse = await getleadApiRequest.call(this, 'POST', '/leads', createBody);
						result = { ...unwrapData(createResponse.body), action: 'created' };
					} else {
						const updated = unwrapData(updateResponse.body);
						const leadId = updated.lead_id as string | undefined;
						if (customFields && leadId) {
							await getleadApiRequest.call(this, 'PATCH', `/leads/${encodeURIComponent(leadId)}`, {
								custom_fields: await withExistingCustomFields.call(
									this,
									leadId,
									customFields as IDataObject,
								),
							});
						}
						result = { ...updated, action: 'updated' };
					}
				} else if (resource === 'lead' && operation === 'find') {
					const search = this.getNodeParameter('search', i) as string;
					const returnAll = this.getNodeParameter('returnAll', i) as boolean;
					const limit = returnAll ? undefined : (this.getNodeParameter('limit', i) as number);
					const filters = this.getNodeParameter('filters', i) as IDataObject;

					const qs: IDataObject = {};
					if (search) qs.search = search;
					for (const [key, value] of Object.entries(filters)) {
						if (Array.isArray(value) && value.length) qs[key] = value;
					}
					result = await getleadListLeads.call(this, qs, limit);
				} else if (resource === 'note' && operation === 'add') {
					const identifyBy = this.getNodeParameter('identifyBy', i) as string;
					const body: IDataObject = { content: this.getNodeParameter('content', i) as string };
					const title = this.getNodeParameter('title', i) as string;
					if (title) body.title = title;

					let endpoint = '/leads/by-identifier/notes';
					if (identifyBy === 'leadId') {
						const leadId = this.getNodeParameter('leadId', i, '', { extractValue: true }) as string;
						endpoint = `/leads/${encodeURIComponent(leadId)}/notes`;
					} else if (identifyBy === 'phone') {
						body.phone_number = (this.getNodeParameter('phoneNumber', i) as string).trim();
					} else {
						body.email = (this.getNodeParameter('email', i) as string).trim();
					}
					const response = await getleadApiRequest.call(this, 'POST', endpoint, body);
					result = { ...unwrapData(response.body) };
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`Unsupported operation "${operation}" for resource "${resource}"`,
						{ itemIndex: i },
					);
				}

				returnData.push(
					...this.helpers.constructExecutionMetaData(this.helpers.returnJsonArray(result), {
						itemData: { item: i },
					}),
				);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				if (error instanceof NodeApiError)
					throw new NodeApiError(this.getNode(), error as unknown as JsonObject);
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
