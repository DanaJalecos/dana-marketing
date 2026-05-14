# 🎂 Deploy — Feature Aniversariantes da Carteira

> Sessão **15/05/2026** · arquivos criados pela próxima sessão do plano `bubbly-forging-pelican.md`
>
> Pra executar end-to-end (Fase 1 → Fase 6) em **~45 minutos** de trabalho seu + **~36 minutos** de espera passiva (burst).

---

## ✅ Checklist do deploy (na ordem)

### 1. SQL — Schema base (Supabase Studio → SQL Editor)

Rodar **1×**, é idempotente:

```
sql-scripts/sql-aniversariantes.sql
```

Cria:
- 3 colunas em `contatos` (`data_nascimento`, `sexo`, `nascimento_sincronizado_em`)
- Tabela `cupons_aniversario` + RLS
- RPC `aniversariantes_do_mes(vendedor_id, mes)`
- RPC `contatos_para_sync_nascimento(modo, limite)`
- RPC `marcar_cupom_enviado(cupom_id)`

Validar:
```sql
SELECT COUNT(*) FROM contatos_para_sync_nascimento('carteira', 99999);
-- esperado: ~3.600 (fila inicial da Fase 1)
```

---

### 2. SQL — Bucket Storage

```
sql-scripts/sql-aniversariantes-storage-bucket.sql
```

Cria bucket público `criativos-aniversario` com policies.

---

### 3. Deploy edges no Supabase

Pela CLI ou Studio → Edge Functions:

```bash
# Subir os 3 novos
supabase functions deploy sync-contatos-detalhes --project-ref wltmiqbhziefusnzmmkt
supabase functions deploy gerar-cupom-aniversario --project-ref wltmiqbhziefusnzmmkt
supabase functions deploy send-email-aniversariantes --project-ref wltmiqbhziefusnzmmkt
```

Ou pelo Studio: cole o conteúdo de cada `edge-functions/*.ts` em nova função homônima.

---

### 4. Smoke test — 1 contato (Jaqueline Marques)

```bash
curl -X POST https://wltmiqbhziefusnzmmkt.supabase.co/functions/v1/sync-contatos-detalhes \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <ANON_KEY>" \
  -H "x-system-cron: true" \
  -d '{"contato_id_unico":16386457953}'
```

Esperado:
```json
{"ok":true,"contato_id":16386457953,"data_nascimento":"1996-12-04","sexo":"F"}
```

Verificar no DB:
```sql
SELECT id, nome, data_nascimento, sexo
FROM contatos WHERE id = 16386457953;
```

---

### 5. Agendar crons

```
sql-scripts/sql-cron-aniversariantes.sql
```

Cria 4 crons:
- `sync_aniv_burst_fase1` (a cada 3min — DESLIGAR após 24h)
- `sync_aniv_diario` (06:00 UTC = 03:00 BRT)
- `alertar_aniversariantes_dia` (11:00 UTC = 08:00 BRT)
- `email_aniversariantes_dia` (11:01 UTC, condicional ao DNS)

Validar:
```sql
SELECT jobname, schedule, active FROM cron.job
WHERE jobname LIKE '%aniv%' ORDER BY jobname;
```

---

### 6. Monitorar burst Fase 1 (36 min)

A cada 3 min uma execução de ~105s vai processar 300 contatos.

Acompanhar:
```sql
-- Progresso
SELECT
  COUNT(*) FILTER (WHERE data_nascimento IS NOT NULL) AS com_nasc,
  COUNT(*) FILTER (WHERE nascimento_sincronizado_em IS NOT NULL) AS tentados,
  COUNT(*) AS total
FROM contatos
WHERE EXISTS (
  SELECT 1 FROM cliente_scoring_vendedor csv
  WHERE csv.contato_id = contatos.id AND csv.vendedor_profile_id IS NOT NULL
);

-- Logs
SELECT created_at, registros, status, detalhes, erro
FROM sync_log
WHERE tabela = 'contatos-detalhes'
ORDER BY created_at DESC
LIMIT 20;
```

Esperado em 36min:
- `tentados ≈ 3.600` (carteira inteira processada)
- `com_nasc ≈ 1.500-2.500` (~50-70% dos contatos têm data preenchida no Bling)

---

### 7. **DESLIGAR burst** (após 24h)

```sql
DO $$
DECLARE jid INT;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'sync_aniv_burst_fase1' LIMIT 1;
  IF jid IS NOT NULL THEN PERFORM cron.unschedule(jid); END IF;
END $$;
```

A partir daí só roda o `sync_aniv_diario` (modo 'ativos' — Fase 2, ~2.400 contatos sem vendedor mas com pedido recente — leva ~5 dias coberto a 500/dia).

---

### 8. Criativo via Estúdio IA (única vez, R$ 0,20)

1. DMS → **Marketing → Estúdio IA → Criar peça**
2. Configurar:
   - **Produto**: escolher um Jaleco icônico da Dana (ex: linha Heloisa)
   - **Tipo de peça**: `post_feed` (1:1)
   - **Tema**: `Feliz Aniversário · 10% off válido todo o mês`
   - **Copy extra**: `presente surpresa, mood acolhedor, paleta quente, confete dourado discreto`
3. Gerar → revisar → aprovar
4. **Download da imagem aprovada**
5. **Upload manual** no bucket `criativos-aniversario` com path **exato** `padrao.png` (Studio → Storage → criativos-aniversario → Upload)

Pra trocar depois: substituir o arquivo `padrao.png` no bucket (URL pública não muda).

---

### 9. Frontend deploy

Já tá tudo em `worktrees/vibrant-davinci`:
- `cliente-360-boot.js` (widget + modal + hook + handler postMessage) — cache-bust `v=69`
- `cliente-360.html` (bumpado pra `v=69`)
- `index.html` (handler de alerta `aniversariantes`)

```bash
git add -A
git commit -m "feat(aniversariantes): widget + edges + crons + bucket — pedido Manu 14/05"
git push danajalecos HEAD:main
```

Vercel pega automático.

---

### 10. Quando o DNS do Resend for configurado

```sql
UPDATE email_config SET resend_dns_configurado = true, atualizado_em = now() WHERE id = 1;
```

Próxima execução do cron `email_aniversariantes_dia` (08:01 BRT seguinte) já manda os emails.

---

## 📋 Smoke test fim-a-fim (depois de tudo aplicado)

1. **DB sincronizou?**
   ```sql
   SELECT data_nascimento FROM contatos WHERE nome ILIKE '%jaqueline marques%';
   -- deve retornar '1996-12-04'
   ```

2. **RPC funciona?**
   ```sql
   SELECT * FROM aniversariantes_do_mes(NULL, 12) LIMIT 5;
   -- deve listar aniversariantes de dezembro
   ```

3. **Widget aparece?**
   - Logar como `admin` ou `gerente_comercial`
   - DMS → C360 → Meus Clientes → expandir "🎂 Aniversariantes deste mês"
   - Deve listar pelo menos a Jaqueline (se mês atual = dezembro)

4. **Gerar cupom funciona?**
   - Click "🎁 Gerar cupom"
   - Modal abre com mensagem WhatsApp, cupom `ANIV-JAQ-1226`, criativo (ou placeholder)
   - Clicar "Marcar como enviado" → linha muda pra ✅ ENVIADO

5. **Alerta no sino (08:00 BRT seguinte se tem aniversariante hoje)?**
   - Esperar 08:00 ou simular: `SELECT cron.job_run_details ... WHERE jobname='alertar_aniversariantes_dia'`
   - Sino mostra: `🎂 Jaqueline Marques faz aniversário hoje`
   - Click no link "Abrir Meus Clientes" → expande widget direto

---

## 🚨 Troubleshooting

| Sintoma | Causa provável | Fix |
|---|---|---|
| Cron burst nada faz | Fila vazia (já rodou) | Verificar `SELECT * FROM contatos_para_sync_nascimento('carteira', 5)` |
| Edge 429 spam | Bling rate limit | Já tem backoff. Se persistir, aumentar `sleep` em sync-contatos-detalhes.ts |
| Cupom retorna 400 "sem_data_nascimento" | Contato sem nascimento no Bling | Pedir Manu pra preencher manualmente no Bling |
| Modal sem criativo | Bucket vazio | Subir `padrao.png` no Storage |
| Email não chega | `resend_dns_configurado=false` | Configurar DNS Resend e setar flag |
| Widget não aparece | Cache do navegador | Hard refresh (Ctrl+Shift+R) |
| Alerta cron com erro | `cliente_scoring_vendedor` retornando NULL | Garantir vendedor mapeado em `cliente_vendedor_manual` |

---

## 📁 Arquivos criados nesta sessão

### SQL (sql-scripts/)
- `sql-aniversariantes.sql` — schema + 3 RPCs
- `sql-aniversariantes-storage-bucket.sql` — bucket Storage
- `sql-cron-aniversariantes.sql` — 4 crons + flag email_config

### Edge Functions (edge-functions/)
- `sync-contatos-detalhes.ts` — puxa dataNascimento contato-a-contato
- `gerar-cupom-aniversario.ts` — cria cupom + mensagem + criativo URL
- `send-email-aniversariantes.ts` — email diário condicional

### Frontend
- `cliente-360-boot.js` — widget 🎂 + modal de envio + hook sob demanda + handler postMessage (v=69)
- `cliente-360.html` — cache-bust v=68 → v=69
- `index.html` — handler do `link_ref='aniversariantes'` em `abrirLinkAlerta()`

### Docs
- `DEPLOY-ANIVERSARIANTES.md` — este guia

---

## 💰 Custo total

- Criativo master Estúdio IA: **R$ 0,20** (única vez)
- ~3.600 calls Bling Fase 1: **R$ 0** (free tier)
- Resend emails diários: dentro do plano grátis

**TOTAL: R$ 0,20**
