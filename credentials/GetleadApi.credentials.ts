import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class GetleadApi implements ICredentialType {
	name = 'getleadApi';

	displayName = 'Getlead API';

	icon: Icon = { light: 'file:../icons/getlead.svg', dark: 'file:../icons/getlead.dark.svg' };

	documentationUrl = 'https://getleadcrm.com/developer-hub';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			placeholder: 'ik_...',
			description:
				'Create one in Getlead CRM under Settings → All Integrations → API Integration → API Keys',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://v3.getleadcrm.com/api/v1',
			description: 'Only change this to point at a staging/test environment',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/meta',
			method: 'GET',
		},
	};
}
