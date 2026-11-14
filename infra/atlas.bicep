// Schematica: one Container App serving the static site, in the shared orch-env environment (rg-orchestrata,
// Canada Central). Resource-group scope, deployed by deploy.ps1 beside this file. It reads the shared identity,
// registry and environment and changes none of them. No secrets, no storage: everything is in the image.
targetScope = 'resourceGroup'

param location string = resourceGroup().location
param prefix string = 'orch'
@description('<registry>/architecture-atlas:<tag>; deploy.ps1 builds and pushes it.')
param image string
param appName string = 'architecture-atlas'
@description('0 lets the app sleep when idle (a few seconds on the first visit after); 1 keeps it warm.')
param minReplicas int = 0
@description('AB#4984: the site\'s own host (infra/site.json; deploy.ps1 passes it). Empty: no custom domain, no redirect.')
param customDomain string = ''
@description('The custom domain is added in two deploys: first without a certificate (false), which lets Azure validate the DNS records and issue the managed certificate; then bound to it (true).')
param certificateReady bool = false
@description('A second host that only redirects to customDomain (www.schematica.ca to schematica.ca), with its own certificate. Empty: none.')
param redirectDomain string = ''
@description('How Azure validates the domain for the certificate: CNAME for a subdomain such as www, HTTP for an apex domain.')
@allowed([ 'CNAME', 'HTTP', 'TXT' ])
param domainValidation string = 'CNAME'

var suffix = uniqueString(resourceGroup().id)

resource id 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = { name: '${prefix}-identity' }
resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = { name: '${prefix}acr${suffix}' }
resource env 'Microsoft.App/managedEnvironments@2024-03-01' existing = { name: '${prefix}-env' }

// AB#4984: the managed certificate for the custom domain lives in the shared environment, the one thing added there.
// It can be issued only once the app carries the host name and the DNS records are in, hence certificateReady.
resource cert 'Microsoft.App/managedEnvironments/managedCertificates@2024-03-01' = if (!empty(customDomain) && certificateReady) {
  parent: env
  name: '${appName}-${replace(customDomain, '.', '-')}'
  location: location
  properties: { subjectName: customDomain, domainControlValidation: domainValidation }
}
// the redirecting host's certificate: a subdomain, so validated by its CNAME
resource redirectCert 'Microsoft.App/managedEnvironments/managedCertificates@2024-03-01' = if (!empty(redirectDomain) && certificateReady) {
  parent: env
  name: '${appName}-${replace(redirectDomain, '.', '-')}'
  location: location
  properties: { subjectName: redirectDomain, domainControlValidation: 'CNAME' }
}
var customDomains = concat(empty(customDomain) ? [] : [ certificateReady
  ? { name: customDomain, bindingType: 'SniEnabled', certificateId: cert.id }
  : { name: customDomain, bindingType: 'Disabled' } ], empty(redirectDomain) ? [] : [ certificateReady
  ? { name: redirectDomain, bindingType: 'SniEnabled', certificateId: redirectCert.id }
  : { name: redirectDomain, bindingType: 'Disabled' } ])

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${id.id}': {} } }
  properties: {
    environmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      // allowInsecure false: plain http is redirected to https by the platform, on every host
      ingress: { external: true, targetPort: 8080, transport: 'auto', allowInsecure: false, customDomains: customDomains }
      registries: [ { server: acr.properties.loginServer, identity: id.id } ]
    }
    template: {
      scale: { minReplicas: minReplicas, maxReplicas: 2, rules: [ { name: 'http', http: { metadata: { concurrentRequests: '100' } } } ] }
      containers: [ {
        name: 'web'
        image: image
        resources: { cpu: json('0.25'), memory: '0.5Gi' }
        // nginx sends the old address and www to customDomain (infra/nginx.conf) only once the hosts are bound to their
        // certificates (certificateReady): Bug AB#5066, the first deploy redirected to a name with no certificate and
        // the site went dark. Until then SITE_DOMAIN is empty and the old address serves as before.
        env: [ { name: 'SITE_DOMAIN', value: certificateReady ? customDomain : '' } ]
        probes: [
          { type: 'Startup', httpGet: { path: '/healthz', port: 8080 }, periodSeconds: 2, failureThreshold: 15 }
          { type: 'Liveness', httpGet: { path: '/healthz', port: 8080 }, periodSeconds: 60, failureThreshold: 3 }
        ]
      } ]
    }
  }
}

output siteUrl string = 'https://${app.properties.configuration.ingress.fqdn}'
output latestRevision string = app.properties.latestRevisionName
output customDomainVerificationId string = env.properties.customDomainConfiguration.customDomainVerificationId
output environmentStaticIp string = env.properties.staticIp
