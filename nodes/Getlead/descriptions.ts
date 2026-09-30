import type { INodeProperties } from 'n8n-workflow';

/** Optional lead fields shared by Create, Update and Create or Update. */
function leadFields(extra: INodeProperties[] = []): INodeProperties[] {
	return [
		...extra,
		{
			displayName: 'Assigned To Name or ID',
			name: 'assigned_to_id',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getUsers' },
			default: '',
			description:
				'Agent to assign the lead to. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		},
		{
			displayName: 'Notes',
			name: 'notes',
			type: 'string',
			typeOptions: { rows: 3 },
			default: '',
		},
		{
			displayName: 'Purpose Names or IDs',
			name: 'purpose_ids',
			type: 'multiOptions',
			typeOptions: { loadOptionsMethod: 'getPurposes' },
			default: [],
			description:
				'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
		{
			displayName: 'Source Name or ID',
			name: 'source_id',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getSources' },
			default: '',
			description:
				'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
		{
			displayName: 'Status Name or ID',
			name: 'status_id',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'getStatuses' },
			default: '',
			description:
				'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		},
	];
}

/** Lead picker: search leads by name/phone/email, or paste an ID. */
function leadLocator(displayOptions: INodeProperties['displayOptions']): INodeProperties {
	return {
		displayName: 'Lead',
		name: 'leadId',
		type: 'resourceLocator',
		required: true,
		default: { mode: 'list', value: '' },
		displayOptions,
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				placeholder: 'Search by name, phone or email…',
				typeOptions: { searchListMethod: 'searchLeads', searchable: true },
			},
			{
				displayName: 'By ID',
				name: 'id',
				type: 'string',
				placeholder: 'e.g. 01M3PBC2E8BAF7D0SZ4DD6VKAE',
			},
		],
	};
}

const nameField: INodeProperties = {
	displayName: 'Name',
	name: 'name',
	type: 'string',
	default: '',
};

const emailField: INodeProperties = {
	displayName: 'Email',
	name: 'email',
	type: 'string',
	placeholder: 'name@email.com',
	default: '',
};

export const leadOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['lead'] } },
		options: [
			{
				name: 'Create',
				value: 'create',
				description: 'Create a new lead',
				action: 'Create a lead',
			},
			{
				name: 'Create or Update',
				value: 'upsert',
				description: 'Create a new record, or update the current one if it already exists (upsert)',
				action: 'Create or update a lead',
			},
			{
				name: 'Find',
				value: 'find',
				description: 'Search leads',
				action: 'Find leads',
			},
			{
				name: 'Update',
				value: 'update',
				description: 'Update a lead by ID',
				action: 'Update a lead',
			},
		],
		default: 'create',
	},
];

export const leadFieldsDescription: INodeProperties[] = [
	/* -------------------------------------------------------------------------- */
	/*                                lead:create                                 */
	/* -------------------------------------------------------------------------- */
	{
		displayName: 'Phone Numbers',
		name: 'phoneNumbers',
		type: 'string',
		required: true,
		default: '',
		placeholder: '+919876543210',
		description: 'One or more phone numbers in E.164 format, separated by commas (max 5)',
		displayOptions: { show: { resource: ['lead'], operation: ['create'] } },
	},
	{
		...nameField,
		displayOptions: { show: { resource: ['lead'], operation: ['create'] } },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['lead'], operation: ['create'] } },
		options: leadFields([emailField]),
	},

	/* -------------------------------------------------------------------------- */
	/*                                lead:update                                 */
	/* -------------------------------------------------------------------------- */
	leadLocator({ show: { resource: ['lead'], operation: ['update'] } }),
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['lead'], operation: ['update'] } },
		options: leadFields([
			emailField,
			nameField,
			{
				displayName: 'Phone Numbers',
				name: 'phoneNumbers',
				type: 'string',
				default: '',
				placeholder: '+919876543210',
				description: 'Replaces the lead’s phone numbers. E.164 format, separated by commas.',
			},
		]),
	},

	/* -------------------------------------------------------------------------- */
	/*                                lead:upsert                                 */
	/* -------------------------------------------------------------------------- */
	{
		displayName: 'Match On',
		name: 'matchOn',
		type: 'options',
		options: [
			{ name: 'Phone Number', value: 'phone' },
			{ name: 'Email', value: 'email' },
		],
		default: 'phone',
		description: 'Which field identifies an existing lead',
		displayOptions: { show: { resource: ['lead'], operation: ['upsert'] } },
	},
	{
		displayName: 'Phone Number',
		name: 'phoneNumber',
		type: 'string',
		required: true,
		default: '',
		placeholder: '+919876543210',
		description:
			'E.164 format. Required because a new lead is created with it when no match exists.',
		displayOptions: { show: { resource: ['lead'], operation: ['upsert'] } },
	},
	{
		...emailField,
		required: true,
		displayOptions: { show: { resource: ['lead'], operation: ['upsert'], matchOn: ['email'] } },
	},
	{
		...nameField,
		displayOptions: { show: { resource: ['lead'], operation: ['upsert'] } },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['lead'], operation: ['upsert'], matchOn: ['phone'] } },
		options: leadFields([emailField]),
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['lead'], operation: ['upsert'], matchOn: ['email'] } },
		options: leadFields(),
	},

	{
		displayName: 'Custom Fields',
		name: 'customFields',
		type: 'resourceMapper',
		noDataExpression: true,
		default: { mappingMode: 'defineBelow', value: null },
		description:
			'Custom fields from your Getlead account. Multi-select fields (e.g. hobbies) are set in "Multi-Select Custom Fields" below.',
		displayOptions: { show: { resource: ['lead'], operation: ['create', 'update', 'upsert'] } },
		typeOptions: {
			resourceMapper: {
				resourceMapperMethod: 'getCustomFieldMapping',
				mode: 'add',
				valuesLabel: 'Custom Fields',
				fieldWords: { singular: 'custom field', plural: 'custom fields' },
				addAllFields: false,
				supportAutoMap: false,
				noFieldsError: 'No custom fields found in your Getlead account',
			},
		},
	},

	{
		displayName: 'Multi-Select Custom Fields',
		name: 'multiSelectFieldsUi',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Multi-Select Field',
		description: 'Custom fields that take several values, such as hobbies',
		default: {},
		displayOptions: { show: { resource: ['lead'], operation: ['create', 'update', 'upsert'] } },
		options: [
			{
				displayName: 'Field',
				name: 'field',
				values: [
					{
						displayName: 'Field Name or ID',
						name: 'key',
						type: 'options',
						typeOptions: { loadOptionsMethod: 'getMultiSelectFields' },
						default: '',
						description:
							'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
					},
					{
						displayName: 'Value Names or IDs',
						name: 'values',
						type: 'multiOptions',
						typeOptions: {
							loadOptionsMethod: 'getMultiSelectValues',
							loadOptionsDependsOn: ['&key'],
						},
						default: [],
						description:
							'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
					},
				],
			},
		],
	},

	/* -------------------------------------------------------------------------- */
	/*                                 lead:find                                  */
	/* -------------------------------------------------------------------------- */
	{
		displayName: 'Search',
		name: 'search',
		type: 'string',
		default: '',
		description: 'Matches name, phone number or email',
		displayOptions: { show: { resource: ['lead'], operation: ['find'] } },
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: { resource: ['lead'], operation: ['find'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { resource: ['lead'], operation: ['find'], returnAll: [false] } },
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: ['lead'], operation: ['find'] } },
		options: [
			{
				displayName: 'Assigned To Names or IDs',
				name: 'assigned_to',
				type: 'multiOptions',
				typeOptions: { loadOptionsMethod: 'getUsers' },
				default: [],
				description:
					'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Source Names or IDs',
				name: 'source',
				type: 'multiOptions',
				typeOptions: { loadOptionsMethod: 'getSources' },
				default: [],
				description:
					'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName: 'Status Names or IDs',
				name: 'status',
				type: 'multiOptions',
				typeOptions: { loadOptionsMethod: 'getStatuses' },
				default: [],
				description:
					'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
		],
	},
];

export const noteOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['note'] } },
		options: [
			{
				name: 'Add',
				value: 'add',
				description: 'Add a note to a lead',
				action: 'Add a note to a lead',
			},
		],
		default: 'add',
	},
];

export const noteFieldsDescription: INodeProperties[] = [
	{
		displayName: 'Find Lead By',
		name: 'identifyBy',
		type: 'options',
		options: [
			{ name: 'Lead', value: 'leadId' },
			{ name: 'Phone Number', value: 'phone' },
			{ name: 'Email', value: 'email' },
		],
		default: 'leadId',
		displayOptions: { show: { resource: ['note'], operation: ['add'] } },
	},
	leadLocator({ show: { resource: ['note'], operation: ['add'], identifyBy: ['leadId'] } }),
	{
		displayName: 'Phone Number',
		name: 'phoneNumber',
		type: 'string',
		required: true,
		default: '',
		placeholder: '+919876543210',
		displayOptions: { show: { resource: ['note'], operation: ['add'], identifyBy: ['phone'] } },
	},
	{
		...emailField,
		required: true,
		displayOptions: { show: { resource: ['note'], operation: ['add'], identifyBy: ['email'] } },
	},
	{
		displayName: 'Content',
		name: 'content',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		displayOptions: { show: { resource: ['note'], operation: ['add'] } },
	},
	{
		displayName: 'Title',
		name: 'title',
		type: 'string',
		default: '',
		displayOptions: { show: { resource: ['note'], operation: ['add'] } },
	},
];
