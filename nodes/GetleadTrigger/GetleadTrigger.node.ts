import {
	NodeConnectionTypes,
	type IDataObject,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type IPollFunctions,
} from 'n8n-workflow';
import {
	extractList,
	getLeadId,
	getleadApiRequest,
	getleadListLeads,
	loadOptions,
} from '../Getlead/GenericFunctions';

// Leads read per poll at most (50 per page). Anything beyond is picked up on the next poll.
const MAX_PAGES_PER_POLL = 10;

function createdAtMs(lead: IDataObject): number {
	return Date.parse(String(lead.created_at ?? ''));
}

export class GetleadTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Getlead Trigger',
		name: 'getleadTrigger',
		icon: { light: 'file:../../icons/getlead.svg', dark: 'file:../../icons/getlead.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: 'New Lead',
		description: 'Starts the workflow when a new lead is created in Getlead CRM',
		defaults: {
			name: 'Getlead Trigger',
		},
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'getleadApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				options: [
					{
						name: 'New Lead',
						value: 'newLead',
						description: 'Triggers when a lead is created',
					},
				],
				default: 'newLead',
			},
			{
				displayName: 'Filters',
				name: 'filters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				options: [
					{
						displayName: 'Source Names or IDs',
						name: 'source',
						type: 'multiOptions',
						typeOptions: { loadOptionsMethod: 'getSources' },
						default: [],
						description:
							'Only trigger for leads from these sources. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
					},
					{
						displayName: 'Status Names or IDs',
						name: 'status',
						type: 'multiOptions',
						typeOptions: { loadOptionsMethod: 'getStatuses' },
						default: [],
						description:
							'Only trigger for leads with these statuses. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
					},
				],
			},
		],
	};

	methods = { loadOptions };

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const staticData = this.getWorkflowStaticData('node');
		const filters = this.getNodeParameter('filters', {}) as IDataObject;

		const qs: IDataObject = { sort_by: 'created_at' };
		for (const [key, value] of Object.entries(filters)) {
			if (Array.isArray(value) && value.length) qs[key] = value;
		}

		const fetchNewest = async () => {
			const { body } = await getleadApiRequest.call(this, 'GET', '/leads', undefined, {
				...qs,
				sort_direction: 'desc',
				per_page: 1,
			});
			return extractList(body)[0] as IDataObject | undefined;
		};

		// "Fetch Test Event" in the editor: return the most recent lead.
		if (this.getMode() === 'manual') {
			const newest = await fetchNewest();
			return newest ? [this.helpers.returnJsonArray([newest])] : null;
		}

		// First poll after activation: remember where we are, don't replay old leads.
		if (!staticData.lastCreatedAt) {
			const newest = await fetchNewest();
			staticData.lastCreatedAt = (newest?.created_at as string) ?? new Date().toISOString();
			staticData.seenIds = newest && getLeadId(newest) ? [getLeadId(newest)] : [];
			return null;
		}

		const lastCreatedAt = staticData.lastCreatedAt as string;
		const lastMs = Date.parse(lastCreatedAt);
		const seenIds = new Set((staticData.seenIds as string[] | undefined) ?? []);

		// Oldest first, so if we stop at MAX_PAGES_PER_POLL the rest are picked up next time.
		const leads = await getleadListLeads.call(
			this,
			{
				...qs,
				sort_direction: 'asc',
				'created_at[from]': new Date(lastMs).toISOString(),
			},
			undefined,
			MAX_PAGES_PER_POLL,
		);

		const newLeads = leads.filter((lead) => {
			const id = getLeadId(lead);
			return !(id && seenIds.has(id)) && !(createdAtMs(lead) < lastMs);
		});
		if (!newLeads.length) return null;

		// Advance the watermark and remember the IDs sharing it (the `from` filter is inclusive).
		let newestCreatedAt = lastCreatedAt;
		for (const lead of newLeads) {
			if (createdAtMs(lead) > Date.parse(newestCreatedAt))
				newestCreatedAt = String(lead.created_at);
		}
		const newestMs = Date.parse(newestCreatedAt);
		const idsAtWatermark = leads
			.filter((lead) => createdAtMs(lead) === newestMs)
			.map(getLeadId)
			.filter((id): id is string => Boolean(id));

		staticData.lastCreatedAt = newestCreatedAt;
		staticData.seenIds =
			newestMs === lastMs ? [...new Set([...seenIds, ...idsAtWatermark])] : idsAtWatermark;

		return [this.helpers.returnJsonArray(newLeads)];
	}
}
