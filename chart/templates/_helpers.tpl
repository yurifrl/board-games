{{- define "board-games.fullname" -}}{{ .Release.Name }}{{- end -}}

{{/*
Worker environment, shared by the sidecar container and the on-demand sync
Workflow so the two modes never drift. Callers add SYNC_ONCE for one-shot runs.
*/}}
{{- define "board-games.workerEnv" -}}
- name: DATA_DIR
  value: /data
- name: SYNC_INTERVAL_MS
  value: {{ (mul .Values.worker.intervalSeconds 1000) | quote }}
- name: OBSIDIAN_API_URL
  value: {{ .Values.obsidianApiUrl | default "https://obsidian.default.svc:27124" | quote }}
- name: OBSIDIAN_INVENTORY_FOLDER
  value: {{ .Values.worker.inventoryFolder | quote }}
- name: OBSIDIAN_USERS_NOTE
  value: {{ .Values.worker.usersNote | quote }}
- name: OBSIDIAN_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ .Values.secretName }}
      key: OBSIDIAN_API_KEY
- name: LUDOPEDIA_ACCESS_TOKEN
  valueFrom:
    secretKeyRef:
      name: {{ .Values.secretName }}
      key: LUDOPEDIA_ACCESS_TOKEN
      optional: true
- name: LUDOPEDIA_COOKIE
  valueFrom:
    secretKeyRef:
      name: {{ .Values.secretName }}
      key: LUDOPEDIA_COOKIE
      optional: true
- name: BGG_BEARER_TOKEN
  valueFrom:
    secretKeyRef:
      name: {{ .Values.secretName }}
      key: BGG_BEARER_TOKEN
      optional: true
{{- if .Values.assetsGcsBucket }}
- name: ASSETS_GCS_BUCKET
  value: {{ .Values.assetsGcsBucket | quote }}
- name: GOOGLE_APPLICATION_CREDENTIALS
  value: /var/secrets/gcp/key.json
{{- end }}
{{- end -}}
