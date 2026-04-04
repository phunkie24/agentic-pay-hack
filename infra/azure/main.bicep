// infra/azure/main.bicep
// Azure Container Apps deployment for production

@description('Location for all resources')
param location string = resourceGroup().location

@description('Container registry name')
param registryName string = 'agenticpayacr'

@description('Environment name')
param envName string = 'agentic-pay-prod'

// ── Container Apps Environment ──
resource containerEnv 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: envName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
    }
  }
}

// ── Azure Cache for Redis ──
resource redisCache 'Microsoft.Cache/redis@2023-08-01' = {
  name: '${envName}-redis'
  location: location
  properties: {
    sku: { name: 'Basic', family: 'C', capacity: 0 }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
  }
}

// ── Key Vault for agent private keys ──
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: '${envName}-kv'
  location: location
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    softDeleteRetentionInDays: 7
  }
}

// ── Agent Container Apps (one per agent) ──
var agents = [
  { name: 'orchestrator', port: 4000, image: 'orchestrator:latest' }
  { name: 'discovery',    port: 4001, image: 'discovery:latest' }
  { name: 'negotiation',  port: 4002, image: 'negotiation:latest' }
  { name: 'payment',      port: 4003, image: 'payment:latest' }
  { name: 'knowledge',    port: 4004, image: 'knowledge:latest' }
  { name: 'validator',    port: 4005, image: 'validator:latest' }
]

resource agentApps 'Microsoft.App/containerApps@2023-05-01' = [for agent in agents: {
  name: '${envName}-${agent.name}'
  location: location
  properties: {
    managedEnvironmentId: containerEnv.id
    configuration: {
      ingress: {
        external: false
        targetPort: agent.port
      }
      secrets: [
        { name: 'anthropic-api-key',  keyVaultUrl: '${keyVault.properties.vaultUri}secrets/anthropic-api-key' }
        { name: 'agent-private-key',  keyVaultUrl: '${keyVault.properties.vaultUri}secrets/${agent.name}-private-key' }
        { name: 'redis-url',          keyVaultUrl: '${keyVault.properties.vaultUri}secrets/redis-url' }
      ]
    }
    template: {
      containers: [{
        name: agent.name
        image: '${registryName}.azurecr.io/${agent.image}'
        resources: { cpu: json('0.5'), memory: '1Gi' }
        env: [
          { name: 'ANTHROPIC_API_KEY',  secretRef: 'anthropic-api-key' }
          { name: 'REDIS_URL',           secretRef: 'redis-url' }
          { name: 'BSV_NETWORK',         value: 'mainnet' }
          { name: 'NODE_ENV',            value: 'production' }
        ]
      }]
      scale: { minReplicas: 1, maxReplicas: 3 }
    }
  }
}]

// ── UI Container App ──
resource uiApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: '${envName}-ui'
  location: location
  properties: {
    managedEnvironmentId: containerEnv.id
    configuration: {
      ingress: { external: true, targetPort: 3002 }
    }
    template: {
      containers: [{
        name: 'ui'
        image: '${registryName}.azurecr.io/ui:latest'
        resources: { cpu: json('0.5'), memory: '1Gi' }
        env: [
          { name: 'NEXT_PUBLIC_API_URL', value: 'https://${envName}-api.azurecontainerapps.io' }
          { name: 'NEXT_PUBLIC_WS_URL',  value: 'wss://${envName}-api.azurecontainerapps.io' }
        ]
      }]
      scale: { minReplicas: 1, maxReplicas: 2 }
    }
  }
}

output uiUrl string = uiApp.properties.configuration.ingress!.fqdn!
