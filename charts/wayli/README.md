# Wayli Helm Chart

A Helm chart for deploying Wayli - a privacy-first location analysis and trip tracking application.

## Prerequisites

- Kubernetes 1.19+
- Helm 3.2.0+
- PersistentVolume provisioner support in the underlying infrastructure (for Fluxbase)
- `openssl` and `docker` (for generating secrets)

## Step 1: Generate Secrets (Required)

Before installing the Helm chart, you **must** generate the required secrets (JWT tokens, encryption keys, passwords):

```bash
cd charts/wayli
./generate-keys.sh
```

Select option **2) Kubernetes Secret** when prompted to generate a `wayli-secrets.yaml` file.

This interactive script will:
- Generate secure random values for all secrets (passwords, JWT tokens, encryption keys)
- Generate JWT tokens automatically using Docker
- Prompt for Fluxbase URLs for your deployment
- Output a Kubernetes Secret manifest

After running the script, apply the generated secrets to your cluster:

```bash
kubectl create namespace wayli
kubectl apply -f wayli-secrets.yaml -n wayli
```

## Step 2: Installation

### Option A: Install from OCI Registry (Recommended)

```bash
# Install with default values
helm install wayli oci://ghcr.io/wayli-app/charts/wayli -n wayli

# Install with custom values
helm install wayli oci://ghcr.io/wayli-app/charts/wayli -n wayli -f custom-values.yaml

# Install a specific version
helm install wayli oci://ghcr.io/wayli-app/charts/wayli --version 1.2.3 -n wayli
```

### Option B: Install from Helm Repository

```bash
# Add the Wayli Helm repository
helm repo add wayli https://wayli-app.github.io/wayli
helm repo update

# Install with default values
helm install wayli wayli/wayli -n wayli

# Install with custom values
helm install wayli wayli/wayli -n wayli -f custom-values.yaml
```

## Configuration

### Basic Configuration

The following table lists the main configurable parameters of the Wayli chart and their default values.

| Parameter | Description | Default |
|-----------|-------------|---------|
| `image.repository` | Wayli image repository | `ghcr.io/wayli-app/wayli` |
| `image.tag` | Wayli image tag (overrides Chart.yaml appVersion) | `""` |
| `image.pullPolicy` | Image pull policy | `IfNotPresent` |
| `web.enabled` | Enable web deployment | `true` |
| `web.replicaCount` | Number of web replicas | `1` |
| `web.env.siteUrl` | Site URL for CORS and trusted origins | `https://wayli.app` |
| `web.service.type` | Kubernetes service type | `ClusterIP` |
| `web.service.port` | Service port | `80` |
| `ingress.enabled` | Enable ingress controller resource | `true` |
| `ingress.hostname` | Ingress hostname | `console.wayli.app` |
| `fluxbase.enabled` | Enable Fluxbase subchart | `true` |
| `fluxbase.global.fluxbase.publicUrl` | Fluxbase API endpoint URL | `https://flux.domain.com` |

### Environment Variables

Configure Wayli through the `web.env` section in `values.yaml`:

```yaml
web:
  env:
    nodeEnv: production
    siteUrl: "https://wayli.domain.com"  # Used for CORS and trusted origins

fluxbase:
  global:
    fluxbase:
      publicUrl: "https://flux.domain.com"  # Fluxbase API endpoint
      siteUrl: "https://wayli.domain.com"  # For auth redirects
```

### Secrets

If you haven't already, run `./generate-keys.sh` as described in [Step 1](#step-1-generate-secrets-required).

#### Manual Secret Creation (Alternative)

Create Kubernetes secrets manually:

```bash
# Create Fluxbase secret
kubectl create secret generic fluxbase-secret \
  --from-literal=jwt-secret=$(openssl rand -base64 48) \
  --from-literal=anon-key=<your-anon-key> \
  --from-literal=service-role-key=<your-service-role-key> \
  --from-literal=db-password=$(openssl rand -base64 40) \
  --from-literal=db-enc-key=$(openssl rand -hex 16) \
  --from-literal=vault-enc-key=$(openssl rand -hex 16) \
  --from-literal=secret-key-base=$(openssl rand -base64 48) \
  -n wayli

# Optional: Create SMTP secret
kubectl create secret generic smtp-secret \
  --from-literal=username=<smtp-username> \
  --from-literal=password=<smtp-password> \
  -n wayli
```

Then configure your `values.yaml` to reference the secrets:

```yaml
fluxbase:
  global:
    fluxbase:
      existingSecret: fluxbase-secret
      auth:
        smtp:
          existingSecret: smtp-secret  # Optional
```

> **Recommendation**: Use external secret management solutions like [External Secrets Operator](https://external-secrets.io/) or [Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets) for production deployments.

### Ingress

To enable external access via Ingress:

```yaml
ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
  hosts:
    - host: wayli.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: wayli-tls
      hosts:
        - wayli.example.com
```

### Resource Limits

Configure resource requests and limits:

```yaml
web:
  resources:
    limits:
      cpu: 500m
      memory: 512Mi
    requests:
      cpu: 250m
      memory: 256Mi
```

### Autoscaling

Enable horizontal pod autoscaling for the web deployment:

```yaml
web:
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 10
    targetCPUUtilizationPercentage: 80
```

## Fluxbase Integration

> **Note:** Fluxbase is included as a Helm chart dependency. You can also use a managed Fluxbase instance if preferred.

Options for Fluxbase deployment:
1. **Chart dependency**: Enabled by default (recommended for self-hosted)
2. **Managed Fluxbase**: Use [Fluxbase Cloud](https://fluxbase.eu) (recommended for production)
3. **Self-hosted**: Deploy Fluxbase separately using the official Helm chart

## Upgrading

### Upgrade to a new version

**OCI Registry:**
```bash
# Upgrade to latest version
helm upgrade wayli oci://ghcr.io/wayli-app/charts/wayli -n wayli

# Upgrade to specific version
helm upgrade wayli oci://ghcr.io/wayli-app/charts/wayli --version 1.2.3 -n wayli

# Upgrade with custom values
helm upgrade wayli oci://ghcr.io/wayli-app/charts/wayli -n wayli -f custom-values.yaml
```

**Helm Repository:**
```bash
# Update repository
helm repo update

# Upgrade release
helm upgrade wayli wayli/wayli -n wayli

# Upgrade with custom values
helm upgrade wayli wayli/wayli -n wayli -f custom-values.yaml
```

### View release history

```bash
helm history wayli -n wayli
```

### Rollback to previous version

```bash
helm rollback wayli -n wayli
```

## Uninstallation

To uninstall/delete the `wayli` release:

```bash
helm uninstall wayli -n wayli
```

This command removes all the Kubernetes components associated with the chart and deletes the release.

## Version Management

This Helm chart is automatically versioned and released via GitHub Actions:

- **Chart Version**: Incremented automatically with each release
- **App Version**: Synced with Wayli application releases (semantic versioning)
- **Docker Images**: Tagged with semantic versions (e.g., `v0.0.1`)

Available versions:
- [Helm Chart (OCI)](https://github.com/wayli-app/wayli/pkgs/container/charts%2Fwayli) - `oci://ghcr.io/wayli-app/charts/wayli`
- [Helm Chart Releases](https://github.com/wayli-app/wayli/releases) - GitHub Pages repository
- [Docker Images](https://github.com/wayli-app/wayli/pkgs/container/wayli) - `ghcr.io/wayli-app/wayli`

## Examples

### Minimal Installation

```yaml
# minimal-values.yaml
ingress:
  enabled: true
  hosts:
    - host: wayli.local
      paths:
        - path: /
          pathType: Prefix

env:
  FLUXBASE_PUBLIC_BASE_URL: "https://flux.domain.com"
  PUBLIC_FLUXBASE_ANON_KEY: "your-anon-key"
```

```bash
helm install wayli wayli/wayli -f minimal-values.yaml -n wayli
```

### Production Installation

```yaml
# production-values.yaml
web:
  replicaCount: 3
  autoscaling:
    enabled: true
    minReplicas: 3
    maxReplicas: 20
  resources:
    limits:
      cpu: 1000m
      memory: 1Gi
    requests:
      cpu: 500m
      memory: 512Mi

ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
  hosts:
    - host: wayli.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: wayli-tls
      hosts:
        - wayli.example.com
```

```bash
helm install wayli wayli/wayli -f production-values.yaml -n wayli
```

## Troubleshooting

### Check pod status

```bash
kubectl get pods -n wayli
```

### View pod logs

```bash
kubectl logs -n wayli -l app.kubernetes.io/name=wayli -f
```

### Describe pod for events

```bash
kubectl describe pod -n wayli <pod-name>
```

### Test connectivity

```bash
kubectl run -it --rm debug --image=curlimages/curl --restart=Never -n wayli -- sh
# Inside the pod:
curl http://wayli-web
```

## Support

For issues and questions:
- [GitHub Issues](https://github.com/wayli-app/wayli/issues)
- [Documentation](https://github.com/wayli-app/wayli)
- [Helm Chart Repository](https://wayli-app.github.io/wayli)

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](../../CONTRIBUTING.md) for details.

## License

Wayli is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). See [LICENSE](../../LICENSE) for details.
