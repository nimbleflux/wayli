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
Return the proper init container image name (flyway)
*/}}
{{- define "wayli.initContainer.flyway.image" -}}
{{- printf "%s:%s" .Values.web.initContainers.migrations.flywayImage.repository .Values.web.initContainers.migrations.flywayImage.tag }}
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
{{- if .Values.fluxbase.global.fluxbase.existingSecret }}
{{- .Values.fluxbase.global.fluxbase.existingSecret }}
{{- else }}
{{- printf "%s-fluxbase" (include "wayli.fullname" .) }}
{{- end }}
{{- end }}

{{/*
Return the SMTP secret name
*/}}
{{- define "wayli.smtpSecretName" -}}
{{- if .Values.fluxbase.global.fluxbase.auth.smtp.existingSecret }}
{{- .Values.fluxbase.global.fluxbase.auth.smtp.existingSecret }}
{{- else }}
{{- printf "%s-smtp" (include "wayli.fullname" .) }}
{{- end }}
{{- end }}

{{/*
Compile all warnings into a single message
*/}}
{{- define "wayli.validateValues" -}}
{{- $messages := list -}}
{{- if and (not .Values.fluxbase.global.fluxbase.existingSecret) (not .Values.secrets.fluxbase.values.jwtSecret) -}}
{{- $messages = append $messages "WARNING: No Fluxbase JWT secret configured. Set fluxbase.global.fluxbase.existingSecret or secrets.fluxbase.values.jwtSecret" -}}
{{- end -}}
{{- if and (not .Values.fluxbase.global.fluxbase.existingSecret) (not .Values.secrets.fluxbase.values.dbPassword) -}}
{{- $messages = append $messages "WARNING: No database password configured. Set fluxbase.global.fluxbase.existingSecret or secrets.fluxbase.values.dbPassword" -}}
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
{{- printf "postgresql://%s:%s@%s:%v/%s?prepareThreshold=0" $dbUser "$(FLYWAY_PASSWORD)" $dbHost $dbPort $dbName -}}
{{- end -}}

{{/*
Return the Fluxbase database URL for workers (conditionally uses pgbouncer from fluxbase chart)
*/}}
{{- define "wayli.fluxbase.dbUrl" -}}
{{- if and .Values.fluxbase.db .Values.fluxbase.db.pgbouncer.enabled -}}
{{- $pgHost := printf "%s.%s.svc.cluster.local" .Values.fluxbase.db.pgbouncer.service.name .Release.Namespace -}}
{{- $pgPort := .Values.fluxbase.db.pgbouncer.service.port -}}
{{- $dbName := include "wayli.fluxbase.dbName" . -}}
{{- $dbUser := include "wayli.fluxbase.dbUser" . -}}
{{- printf "postgresql://%s:$(FLUXBASE_DB_PASSWORD)@%s:%v/%s" $dbUser $pgHost $pgPort $dbName -}}
{{- else -}}
{{- $dbHost := printf "%s-fluxbase-db.%s.svc.cluster.local" .Release.Name .Release.Namespace -}}
{{- $dbPort := include "wayli.fluxbase.dbPort" . -}}
{{- $dbName := include "wayli.fluxbase.dbName" . -}}
{{- $dbUser := include "wayli.fluxbase.dbUser" . -}}
{{- printf "postgresql://%s:$(FLUXBASE_DB_PASSWORD)@%s:%v/%s" $dbUser $dbHost $dbPort $dbName -}}
{{- end -}}
{{- end -}}

{{/*
Return the Fluxbase public URL
*/}}
{{- define "wayli.fluxbase.url" -}}
{{- if .Values.externalFluxbase.enabled -}}
{{- .Values.externalFluxbase.url -}}
{{- else if .Values.fluxbase.global.fluxbase.publicUrl -}}
{{- .Values.fluxbase.global.fluxbase.publicUrl -}}
{{- else -}}
{{- fail "Either externalFluxbase.url or fluxbase.global.fluxbase.publicUrl must be set" -}}
{{- end -}}
{{- end -}}

{{/*
Return the Fluxbase database host (uses pgbouncer if enabled)
*/}}
{{- define "wayli.fluxbase.dbHost" -}}
{{- if .Values.externalFluxbase.enabled -}}
{{- .Values.externalFluxbase.dbHost -}}
{{- else if and .Values.fluxbase.db .Values.fluxbase.db.pgbouncer.enabled -}}
{{- printf "%s-fluxbase-pgbouncer" .Release.Name -}}
{{- else -}}
{{- printf "%s-fluxbase-db" .Release.Name -}}
{{- end -}}
{{- end -}}

{{/*
Return the Fluxbase database port
*/}}
{{- define "wayli.fluxbase.dbPort" -}}
{{- if .Values.externalFluxbase.enabled -}}
{{- .Values.externalFluxbase.dbPort -}}
{{- else if and .Values.fluxbase.db .Values.fluxbase.db.pgbouncer.enabled -}}
{{- .Values.fluxbase.db.pgbouncer.service.port | default 6432 -}}
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
{{- else -}}
postgres
{{- end -}}
{{- end -}}

{{/*
Return the Fluxbase database user
*/}}
{{- define "wayli.fluxbase.dbUser" -}}
{{- if .Values.externalFluxbase.enabled -}}
{{- .Values.externalFluxbase.dbUser -}}
{{- else -}}
fluxbase_admin
{{- end -}}
{{- end -}}

{{/*
Return the Fluxbase Kong host
*/}}
{{- define "wayli.fluxbase.kongHost" -}}
{{- if .Values.externalFluxbase.enabled -}}
{{- .Values.externalFluxbase.kongHost -}}
{{- else -}}
{{- printf "%s-fluxbase" .Release.Name -}}
{{- end -}}
{{- end -}}

{{/*
Return the Fluxbase Kong port
*/}}
{{- define "wayli.fluxbase.kongPort" -}}
{{- if .Values.externalFluxbase.enabled -}}
{{- .Values.externalFluxbase.kongPort -}}
{{- else -}}
8000
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
    - name: KONG_SERVICE
      value: "{{ include "wayli.fluxbase.kongHost" . }}.{{ .Release.Namespace }}.svc.cluster.local:{{ include "wayli.fluxbase.kongPort" . }}"
    - name: FLUXBASE_ANON_KEY
      valueFrom:
        secretKeyRef:
          name: {{ include "wayli.fluxbaseSecretName" . }}
          key: {{ .Values.fluxbase.global.fluxbase.secretKeys.anonKey }}
  command:
    - /bin/sh
    - -c
    - |
      echo "Waiting for Fluxbase Auth service to be ready via Kong..."
      until wget --header="apikey: ${FLUXBASE_ANON_KEY}" \
        --header="Authorization: Bearer ${FLUXBASE_ANON_KEY}" \
        -O /dev/null --timeout=5 --tries=1 -q \
        "http://${KONG_SERVICE}/auth/v1/health"; do
        echo "Auth service not ready, waiting..."
        sleep 2
      done
      echo "Fluxbase Auth service is ready"

      echo "Waiting for Fluxbase Storage service to be ready via Kong..."
      until wget --header="apikey: ${FLUXBASE_ANON_KEY}" \
        --header="Authorization: Bearer ${FLUXBASE_ANON_KEY}" \
        -O /dev/null --timeout=5 --tries=1 -q \
        "http://${KONG_SERVICE}/storage/v1/status"; do
        echo "Storage service not ready, waiting..."
        sleep 2
      done
      echo "Fluxbase Storage service is ready"
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
    - name: FLYWAY_USER
      value: {{ include "wayli.fluxbase.dbUser" . | quote }}
    - name: FLYWAY_PASSWORD
      valueFrom:
        secretKeyRef:
          name: {{ include "wayli.fluxbaseSecretName" . }}
          key: {{ .Values.fluxbase.db.postgres.secretKeys.userPasswordKey }}
    - name: DB_NAME
      value: {{ include "wayli.fluxbase.dbName" . | quote }}
    - name: FLYWAY_URL
      value: jdbc:postgresql://$(DB_HOST):{{ include "wayli.fluxbase.dbPort" . }}/$(DB_NAME)
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
          key: {{ .Values.fluxbase.db.postgres.secretKeys.userPasswordKey }}
    - name: PGDATABASE
      value: {{ include "wayli.fluxbase.dbName" . | quote }}
  command:
    - /bin/bash
    - -c
    - |
      echo "Waiting for database to be ready..."
      while ! pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$FLYWAY_USER" -d "$DB_NAME"; do
        echo "Database not ready, waiting..."
        sleep 1
      done
      echo "Database is ready"

      echo "Waiting for Fluxbase Storage migrations to complete..."
      until [ "$(psql -tAc "SELECT COUNT(*) FROM storage.migrations;" 2>/dev/null || echo 0)" -ge 44 ]; do
        echo "Storage migrations not complete yet, waiting..."
        sleep 2
      done
      echo "Fluxbase Storage migrations are complete."
{{- end }}
{{- end -}}
