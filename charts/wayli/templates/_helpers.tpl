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
Return the proper init container image name (postgres)
*/}}
{{- define "wayli.initContainer.postgres.image" -}}
{{- printf "%s:%s" .Values.web.initContainers.waitForDb.image.repository .Values.web.initContainers.waitForDb.image.tag }}
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
Return the database URL for init containers
*/}}
{{- define "wayli.databaseUrl" -}}
{{- $dbHost := printf "%s.%s.svc.cluster.local" (include "wayli.fluxbase.dbHost" .) .Release.Namespace -}}
{{- $dbPort := include "wayli.fluxbase.dbPort" . -}}
{{- $dbName := include "wayli.fluxbase.dbName" . -}}
{{- $dbUser := include "wayli.fluxbase.dbUser" . -}}
{{- printf "postgresql://%s:%s@%s:%v/%s?prepareThreshold=0" $dbUser "$(DB_PASSWORD)" $dbHost $dbPort $dbName -}}
{{- end -}}

{{/*
Return the Fluxbase database URL for workers
*/}}
{{- define "wayli.fluxbase.dbUrl" -}}
{{- $dbHost := printf "%s.%s.svc.cluster.local" (include "wayli.fluxbase.dbHost" .) .Release.Namespace -}}
{{- $dbPort := include "wayli.fluxbase.dbPort" . -}}
{{- $dbName := include "wayli.fluxbase.dbName" . -}}
{{- $dbUser := include "wayli.fluxbase.dbUser" . -}}
{{- printf "postgresql://%s:$(FLUXBASE_DB_PASSWORD)@%s:%v/%s" $dbUser $dbHost $dbPort $dbName -}}
{{- end -}}

{{/*
Return the Fluxbase public URL
*/}}
{{- define "wayli.fluxbase.url" -}}
{{- if .Values.externalFluxbase.enabled -}}
{{- .Values.externalFluxbase.url -}}
{{- else if .Values.fluxbase.config.base_url -}}
{{- .Values.fluxbase.config.base_url -}}
{{- else -}}
{{- fail "Either externalFluxbase.url or fluxbase.config.base_url must be set" -}}
{{- end -}}
{{- end -}}

{{/*
Return the Fluxbase database host
*/}}
{{- define "wayli.fluxbase.dbHost" -}}
{{- if .Values.externalFluxbase.enabled -}}
{{- .Values.externalFluxbase.dbHost -}}
{{- else if not .Values.fluxbase.postgresql.enabled -}}
{{- .Values.fluxbase.externalDatabase.host -}}
{{- else -}}
{{- printf "%s-fluxbase-postgresql" .Release.Name -}}
{{- end -}}
{{- end -}}

{{/*
Return the Fluxbase database port
*/}}
{{- define "wayli.fluxbase.dbPort" -}}
{{- if .Values.externalFluxbase.enabled -}}
{{- .Values.externalFluxbase.dbPort -}}
{{- else if not .Values.fluxbase.postgresql.enabled -}}
{{- .Values.fluxbase.externalDatabase.port | default 5432 -}}
{{- else -}}
5432
{{- end -}}
{{- end -}}

{{/*
Return the Fluxbase database name
*/}}
{{- define "wayli.fluxbase.dbName" -}}
{{- if .Values.externalFluxbase.enabled -}}
{{- .Values.externalFluxbase.dbName -}}
{{- else if not .Values.fluxbase.postgresql.enabled -}}
{{- .Values.fluxbase.externalDatabase.database | default "fluxbase" -}}
{{- else -}}
{{- .Values.fluxbase.postgresql.auth.database | default "fluxbase" -}}
{{- end -}}
{{- end -}}

{{/*
Return the Fluxbase database user
*/}}
{{- define "wayli.fluxbase.dbUser" -}}
{{- if .Values.externalFluxbase.enabled -}}
{{- .Values.externalFluxbase.dbUser -}}
{{- else if not .Values.fluxbase.postgresql.enabled -}}
{{- .Values.fluxbase.externalDatabase.user | default "fluxbase" -}}
{{- else -}}
{{- .Values.fluxbase.postgresql.auth.username | default "fluxbase" -}}
{{- end -}}
{{- end -}}

{{/*
Return the Fluxbase service host (replaces Kong host)
*/}}
{{- define "wayli.fluxbase.serviceHost" -}}
{{- if .Values.externalFluxbase.enabled -}}
{{- .Values.externalFluxbase.host | default .Values.externalFluxbase.url -}}
{{- else if .Values.fluxbase.fullnameOverride -}}
{{- .Values.fluxbase.fullnameOverride -}}
{{- else -}}
{{- printf "%s-fluxbase" .Release.Name -}}
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
Common initContainers for waiting for Fluxbase services and database
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
{{- if .Values.web.initContainers.waitForDb.enabled }}
- name: wait-for-db
  image: {{ include "wayli.initContainer.postgres.image" . }}
  imagePullPolicy: {{ .Values.web.initContainers.waitForDb.image.pullPolicy }}
  env:
    - name: DB_HOST
      value: "{{ include "wayli.fluxbase.dbHost" . }}.{{ .Release.Namespace }}.svc.cluster.local"
    - name: DB_PORT
      value: {{ include "wayli.fluxbase.dbPort" . | quote }}
    - name: DB_USER
      value: {{ include "wayli.fluxbase.dbUser" . | quote }}
    - name: DB_PASSWORD
      valueFrom:
        secretKeyRef:
          name: {{ include "wayli.fluxbaseSecretName" . }}
          key: {{ .Values.fluxbase.existingSecretKeyRef.databasePassword }}
    - name: DB_NAME
      value: {{ include "wayli.fluxbase.dbName" . | quote }}
    - name: DATABASE_URL
      value: {{ include "wayli.databaseUrl" . | quote }}
    - name: PGHOST
      value: "{{ include "wayli.fluxbase.dbHost" . }}.{{ .Release.Namespace }}.svc.cluster.local"
    - name: PGPORT
      value: {{ include "wayli.fluxbase.dbPort" . | quote }}
    - name: PGUSER
      value: {{ include "wayli.fluxbase.dbUser" . | quote }}
    - name: PGPASSWORD
      valueFrom:
        secretKeyRef:
          name: {{ include "wayli.fluxbaseSecretName" . }}
          key: {{ .Values.fluxbase.existingSecretKeyRef.databasePassword }}
    - name: PGDATABASE
      value: {{ include "wayli.fluxbase.dbName" . | quote }}
  command:
    - /bin/bash
    - -c
    - |
      echo "Waiting for database to be ready..."
      while ! pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME"; do
        echo "Database not ready, waiting..."
        sleep 1
      done
      echo "Database is ready"
{{- end }}
{{- end -}}
