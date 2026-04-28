# Guia de Setup — Google Analytics 4 no DMS

Este guia explica passo a passo como criar um **Service Account** no Google Cloud pra que o DMS puxe dados do GA4 automaticamente.

**Tempo estimado**: 5-10 minutos
**Custo**: R$ 0 (tudo dentro dos planos gratuitos)

---

## 🎯 Por que Service Account (e não OAuth)?

Em vez do OAuth clássico (que exige cada usuário logar), usamos um **Service Account** — uma "conta de serviço" que pertence ao Google Cloud da Dana e tem acesso de leitura ao GA4.

Vantagens:
- **Configura uma vez só** (não precisa reautorizar a cada 60 dias)
- **Não precisa de App Review** da Google
- **Nenhum usuário precisa logar** — o DMS puxa os dados sozinho em background
- **Chave JSON fica no Supabase como secret** (criptografado, não vai pro GitHub)

---

## 📋 Passo a passo

### 1. Criar projeto no Google Cloud

1. Acesse https://console.cloud.google.com/
2. Entre com a conta Google que tem acesso ao GA4
3. Topo da página → menu de projetos → **"Novo projeto"**
4. Nome: `dana-ga4-integration` (ou outro)
5. Clique **"Criar"**

### 2. Ativar a Google Analytics Data API

1. No menu lateral → **APIs & Services → Library**
2. Busca: `Google Analytics Data API`
3. Clique no resultado → botão **"Enable"**

### 3. Criar o Service Account

1. Menu lateral → **IAM & Admin → Service Accounts**
2. Botão **"+ CREATE SERVICE ACCOUNT"**
3. **Service account name**: `dms-ga4-reader`
4. Clique **"Create and continue"**
5. **Role**: deixa em branco (não precisa) → clique **"Continue"**
6. Skip "Grant users access" → **"Done"**

### 4. Gerar a chave JSON

1. Na lista de Service Accounts, clique no que você acabou de criar
2. Aba **"Keys"**
3. **"Add Key → Create new key"**
4. Tipo: **JSON**
5. **"Create"** → um arquivo `.json` vai baixar automaticamente
6. **⚠️ Guarde esse arquivo em lugar seguro.** Ele é a senha do Service Account.

### 5. Dar acesso ao GA4

1. Abra o arquivo JSON baixado, copie o valor do campo `"client_email"` (algo como `dms-ga4-reader@dana-ga4-integration.iam.gserviceaccount.com`)
2. Entre em https://analytics.google.com/
3. Selecione a propriedade GA4 do site danajalecos.com.br
4. Canto inferior esquerdo → **⚙️ Admin**
5. Coluna **"Property"** → **"Property Access Management"**
6. Botão **"+ "** no canto superior direito → **"Add users"**
7. No campo de email, cole o `client_email` do Service Account
8. Roles: marque **"Viewer"** (só leitura)
9. Desmarque "Notify new users by email"
10. **"Add"**

### 6. Pegar o Property ID

1. Ainda em Admin → coluna **"Property"**
2. **"Property details"**
3. No topo tem um **ID numérico** (ex: `123456789`)
4. Copie esse número

### 7. Me mandar os 2 itens

Me envia aqui no chat:

1. O **conteúdo do arquivo JSON** (abre no Bloco de Notas, copia tudo e cola aqui)
2. O **Property ID** (só os números)

Com isso eu termino a Fase 2 da integração (Edge Function + dashboard) no DMS.

---

## 🔒 Segurança

- O JSON **nunca** vai pro código-fonte ou GitHub
- Fica só como **Supabase Secret** (criptografado em repouso)
- Só o **backend** (Edge Function) tem acesso
- Se vazar por algum motivo, dá pra **revogar no Google Cloud** em 1 clique (vai no Service Account → Keys → deleta)

## 💰 Custos

- **Google Cloud Project**: grátis (free tier)
- **Data API**: 25.000 requests/dia grátis (sobram uns 24.995 pro Dana)
- **Service Account**: grátis
- **Supabase Edge Function**: 500k invocações/mês grátis

Total: **R$ 0,00** por mês.

## ❓ Dúvidas comuns

**"Preciso de cartão de crédito no Google Cloud?"**
Sim, mas só pra ativar billing. Não vai cobrar nada dentro dos limites gratuitos.

**"E se eu não tiver GA4 configurado no site?"**
Aí precisa configurar primeiro. Se for o caso, me avisa que eu oriento.

**"Posso revogar a qualquer momento?"**
Sim. Vai no Service Account e deleta a chave → DMS para de puxar dados imediatamente.
