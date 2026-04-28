const fs = require('fs');
const cards = JSON.parse(fs.readFileSync('C:/Users/Juan - Dana Jalecos/Documents/Sistema Marketing/ASteNIOH.json', 'utf8'));

// Extrair listas
const lists = {};
cards.lists.forEach(l => { if (!l.closed) lists[l.id] = l.name; });

// Mapear nomes de listas para colunas do kanban
const listToCol = {
  'Marcas referencias': 'referencias',
  'MATERIAIS': 'materiais',
  'Campanhas 2 tri': 'campanhas_q2',
  'PRODUÇÃO': 'producao',
  'Cronograma Março': 'crono_marco',
  'Cronograma Abril': 'crono_abril',
  'Compre e ganhe 02/04 - 12/04': 'compre_ganhe',
  'To do - Luana': 'todo_luana',
  'ROTEIROS A PRODUZIR': 'roteiros',
  'Campanhas ativas': 'campanhas_ativas',
  'To Do - última reuniao': 'todo_reuniao',
  'Black Friday Dana': 'black_friday',
  'Informações Jaleco box': 'jaleco_box',
  'Rede Sociais': 'redes_sociais',
  '10 Anos Dana': '10_anos',
  'Jaleco BOX - 16/03 A 22/03': 'jaleco_box_marco',
  'Semana do consumidor': 'semana_consumidor',
  'Campanhas 1 Tri': 'campanhas_q1',
};

// Extrair checklists
const checklistMap = {};
(cards.checklists || []).forEach(cl => {
  checklistMap[cl.idCard] = checklistMap[cl.idCard] || [];
  cl.checkItems.forEach(ci => {
    checklistMap[cl.idCard].push({ text: ci.name, done: ci.state === 'complete' });
  });
});

// Extrair attachments
const attachMap = {};
(cards.actions || []).forEach(a => {
  if (a.type === 'addAttachmentToCard' && a.data && a.data.attachment) {
    const cardId = a.data.card ? a.data.card.id : null;
    if (cardId) {
      attachMap[cardId] = attachMap[cardId] || [];
      attachMap[cardId].push({
        name: a.data.attachment.name || '',
        url: a.data.attachment.url || '',
      });
    }
  }
});

// Escapar para SQL
function esc(s) {
  return (s || '').replace(/'/g, "''").replace(/\\/g, '\\\\').substring(0, 2000);
}

let sql = '-- ══════════════════════════════════════════════════════════\n';
sql += '-- Migração COMPLETA Trello → DMS Kanban (460 cards)\n';
sql += '-- Gerado automaticamente do ASteNIOH.json\n';
sql += '-- ══════════════════════════════════════════════════════════\n\n';
sql += '-- Limpar tarefas anteriores\nDELETE FROM tarefas;\n\n';

const pos = {};
let count = 0;

const activeCards = cards.cards.filter(c => !c.closed);

activeCards.forEach((c) => {
  const listName = lists[c.idList] || 'unknown';
  const col = listToCol[listName] || listName.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 30);
  if (!pos[col]) pos[col] = 0;

  const titulo = esc(c.name).substring(0, 200);
  const desc = esc(c.desc);
  const labelArr = c.labels || [];
  const tag = labelArr.length > 0 ? esc(labelArr[0].name || labelArr[0].color || '') : '';
  const due = c.due ? c.due.split('T')[0] : null;

  const checklist = checklistMap[c.id] || [];
  const checkJson = checklist.length > 0 ? esc(JSON.stringify(checklist)) : '[]';

  const attachments = attachMap[c.id] || [];
  let linksStr = 'NULL';
  if (attachments.length > 0) {
    const urls = attachments.map(a => "'" + esc(a.url) + "'").join(',');
    linksStr = 'ARRAY[' + urls + ']';
  }

  sql += "INSERT INTO tarefas (titulo, descricao, coluna, tag, prioridade, posicao, prazo, checklist, links) VALUES (";
  sql += "'" + titulo + "', ";
  sql += "'" + desc + "', ";
  sql += "'" + col + "', ";
  sql += "'" + tag + "', ";
  sql += "'media', ";
  sql += pos[col]++ + ", ";
  sql += (due ? "'" + due + "'" : "NULL") + ", ";
  sql += "'" + checkJson + "'::jsonb, ";
  sql += linksStr;
  sql += ");\n";
  count++;
});

fs.writeFileSync('sql-trello-full.sql', sql);
console.log('Total cards:', count);
console.log('Colunas:', Object.keys(pos));
console.log('Com checklists:', Object.keys(checklistMap).length);
console.log('Com attachments:', Object.keys(attachMap).length);
console.log('Saved to sql-trello-full.sql');
