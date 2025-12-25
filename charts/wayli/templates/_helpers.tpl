{{/*
Expand the name of the chart.
*/}}
{{- define "wayli.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "wayli.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "wayli.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "wayli.labels" -}}
helm.sh/chart: {{ include "wayli.chart" . }}
{{ include "wayli.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- with .Values.global.labels }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "wayli.selectorLabels" -}}
app.kubernetes.io/name: {{ include "wayli.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Component-specific selector labels
*/}}
{{- define "wayli.selectorLabels.web" -}}
{{ include "wayli.selectorLabels" . }}
app.kubernetes.io/component: web
{{- end }}

{{- define "wayli.selectorLabels.worker" -}}
{{ include "wayli.selectorLabels" . }}
app.kubernetes.io/component: worker
{{- end }}

{{- define "wayli.selectorLabels.public" -}}
{{ include "wayli.selectorLabels" . }}
app.kubernetes.io/component: public
{{- end }}

{{- define "wayli.selectorLabels.pgbouncer" -}}
{{ include "wayli.selectorLabels" . }}
app.kubernetes.io/component: pgbouncer
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "wayli.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "wayli.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Return the proper Wayli image name
*/}}
{{- define "wayli.image" -}}
{{- $tag := .Values.image.tag | default .Chart.AppVersion }}
{{- printf "%s:%s" .Values.image.repository $tag }}
{{- end }}

{{/*
Return the proper Wayli public image name
*/}}
{{- define "wayli.publicImage" -}}
{{- $tag := .Values.publicImage.tag | default .Chart.AppVersion }}
{{- printf "%s:%s" .Values.publicImage.repository $tag }}
{{- end }}

{{/*
Return the proper PgBouncer image name
*/}}
{{- define "wayli.pgbouncer.image" -}}
{{- printf "%s:%s" .Values.pgbouncer.image.repository .Values.pgbouncer.image.tag }}
{{- end }}

{{/*
Return the proper image pull secrets
*/}}
{{- define "wayli.imagePullSecrets" -}}
{{- if .Values.image.pullSecrets }}
imagePullSecrets:
{{- range .Values.image.pullSecrets }}
  - name: {{ . }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Return the Fluxbase secret name
*/}}
{{- define "wayli.fluxbaseSecretName" -}}
{{- if .Values.fluxbase.existingSecret }}
{{- .Values.fluxbase.existingSecret }}
{{- else }}
{{- printf "%s-fluxbase" (include "wayli.fullname" .) }}
{{- end }}
{{- end }}

{{/*
Return the SMTP secret name (now uses the main fluxbase secret)
*/}}
{{- define "wayli.smtpSecretName" -}}
{{- include "wayli.fluxbaseSecretName" . -}}
{{- end }}

{{/*
Compile all warnings into a single message
*/}}
{{- define "wayli.validateValues" -}}
{{- $messages := list -}}
{{- if and (not .Values.fluxbase.existingSecret) (not .Values.fluxbase.config.auth.jwt_secret) -}}
{{- $messages = append $messages "WARNING: No Fluxbase JWT secret configured. Set fluxbase.existingSecret or fluxbase.config.auth.jwt_secret" -}}
{{- end -}}
{{- if and (not .Values.fluxbase.existingSecret) (not .Values.fluxbase.postgresql.auth.password) (not .Values.fluxbase.postgresql.auth.existingSecret) -}}
{{- $messages = append $messages "WARNING: No database password configured. Set fluxbase.existingSecret, fluxbase.postgresql.auth.password, or fluxbase.postgresql.auth.existingSecret" -}}
{{- end -}}
{{- if $messages -}}
{{- printf "\nVALIDATION WARNINGS:\n%s" (join "\n" $messages) | fail -}}
{{- end -}}
{{- end -}}

{{/*
Return the Fluxbase public URL
*/}}
{{- define "wayli.fluxbase.url" -}}
{{- if .Values.externalFluxbase.enabled -}}
{{- .Values.externalFluxbase.url -}}
{{- else if .Values.fluxbase.config.public_base_url -}}
{{- .Values.fluxbase.config.public_base_url -}}
{{- else if .Values.fluxbase.config.base_url -}}
{{- .Values.fluxbase.config.base_url -}}
{{- else -}}
{{- fail "Either externalFluxbase.url or fluxbase.config.public_base_url or fluxbase.config.base_url must be set" -}}
{{- end -}}
{{- end -}}

{{/*
Return the Fluxbase internal URL (for server-to-server communication)
Constructs cluster-internal URL from serviceHost and servicePort
*/}}
{{- define "wayli.fluxbase.internalUrl" -}}
{{- if and .Values.externalFluxbase.enabled .Values.externalFluxbase.internalUrl -}}
{{- .Values.externalFluxbase.internalUrl -}}
{{- else -}}
{{- printf "http://%s.%s.svc.cluster.local:%s" (include "wayli.fluxbase.serviceHost" .) .Release.Namespace (include "wayli.fluxbase.servicePort" . | toString) -}}
{{- end -}}
{{- end -}}

{{/*
Return the Fluxbase database host
*/}}
{{- define "wayli.fluxbase.dbHost" -}}
{{- if not .Values.fluxbase.postgresql.enabled -}}
{{- .Values.fluxbase.externalDatabase.host -}}
{{- else if .Values.fluxbase.fullnameOverride -}}
{{- printf "%s-postgresql" .Values.fluxbase.fullnameOverride -}}
{{- else -}}
{{- printf "%s-fluxbase-postgresql" .Release.Name -}}
{{- end -}}
{{- end -}}

{{/*
Return the Fluxbase database port
*/}}
{{- define "wayli.fluxbase.dbPort" -}}
{{- if not .Values.fluxbase.postgresql.enabled -}}
{{- .Values.fluxbase.externalDatabase.port | default 5432 -}}
{{- else -}}
5432
{{- end -}}
{{- end -}}

{{/*
Return the Fluxbase database name
*/}}
{{- define "wayli.fluxbase.dbName" -}}
{{- if not .Values.fluxbase.postgresql.enabled -}}
{{- .Values.fluxbase.externalDatabase.database | default "fluxbase" -}}
{{- else -}}
{{- .Values.fluxbase.postgresql.auth.database | default "fluxbase" -}}
{{- end -}}
{{- end -}}

{{/*
Return the Fluxbase database user
*/}}
{{- define "wayli.fluxbase.dbUser" -}}
{{- if not .Values.fluxbase.postgresql.enabled -}}
{{- .Values.fluxbase.externalDatabase.user | default "fluxbase" -}}
{{- else -}}
{{- .Values.fluxbase.postgresql.auth.username | default "fluxbase" -}}
{{- end -}}
{{- end -}}

{{/*
Return the Fluxbase service host (replaces Kong host)
Uses the same naming logic as the Fluxbase subchart's fullname helper
*/}}
{{- define "wayli.fluxbase.serviceHost" -}}
{{- if .Values.externalFluxbase.enabled -}}
{{- .Values.externalFluxbase.host | default .Values.externalFluxbase.url -}}
{{- else if .Values.fluxbase.fullnameOverride -}}
{{- .Values.fluxbase.fullnameOverride -}}
{{- else -}}
{{- $name := "fluxbase" -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Return the Fluxbase service port (replaces Kong port)
*/}}
{{- define "wayli.fluxbase.servicePort" -}}
{{- if .Values.externalFluxbase.enabled -}}
{{- .Values.externalFluxbase.port | default 8080 -}}
{{- else -}}
{{- .Values.fluxbase.service.ports.http | default 8080 -}}
{{- end -}}
{{- end -}}

{{/*
Return the site URL
*/}}
{{- define "wayli.siteUrl" -}}
{{- .Values.web.env.siteUrl -}}
{{- end -}}

{{/*
Common initContainers for waiting for Fluxbase services
*/}}
{{- define "wayli.initContainers.waitForInfrastructure" -}}
{{- if .Values.web.initContainers.waitForFluxbase.enabled }}
- name: wait-for-fluxbase
  image: {{ .Values.web.initContainers.waitForFluxbase.image.repository }}:{{ .Values.web.initContainers.waitForFluxbase.image.tag }}
  imagePullPolicy: {{ .Values.web.initContainers.waitForFluxbase.image.pullPolicy }}
  env:
    - name: FLUXBASE_SERVICE
      value: "{{ include "wayli.fluxbase.serviceHost" . }}.{{ .Release.Namespace }}.svc.cluster.local:{{ include "wayli.fluxbase.servicePort" . }}"
  command:
    - /bin/sh
    - -c
    - |
      echo "Waiting for Fluxbase health endpoint to be ready..."
      until wget -O /dev/null --timeout=5 --tries=1 -q \
        "http://${FLUXBASE_SERVICE}/health"; do
        echo "Fluxbase not ready, waiting..."
        sleep 2
      done
      echo "Fluxbase is ready"
{{- end }}
{{- end -}}
