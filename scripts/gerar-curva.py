# Gera src/data/curva-seed.js a partir da planilha da Curva S (aba "BD - REV").
# Uso (na raiz do repositório):
#   python3 -I scripts/gerar-curva.py "3º Contrato - Curva S ... (Semanal).xlsm" src/data/curva-seed.js
# Por semana: BM, rótulo do BM, início e fim, dias úteis, previsto e replanejado.
# O realizado não entra: ele sai dos lançamentos do app.
import sys, json, re, datetime as dt, warnings, openpyxl
warnings.filterwarnings('ignore')
origem, saida = sys.argv[1], sys.argv[2]
ws = openpyxl.load_workbook(origem, data_only=True, keep_vba=True)['BD - REV']
def data_texto(v):
    if isinstance(v, (dt.datetime, dt.date)): return v.strftime('%Y-%m-%d')
    m = re.search(r'(\d{2})/(\d{2})/(\d{4})', str(v or ''))
    return f'{m.group(3)}-{m.group(2)}-{m.group(1)}' if m else None
def num(v):
    return None if v in (None, '') else round(float(v), 4)
semanas = []
for r in range(2, ws.max_row + 1):
    bm, rot, ini, fim = ws.cell(r, 1).value, ws.cell(r, 2).value, ws.cell(r, 5).value, ws.cell(r, 6).value
    if not bm or not data_texto(ini): continue
    semanas.append({'bm': str(bm).strip(), 'bmRotulo': str(rot or '').strip(), 'semana': str(ws.cell(r, 8).value or '').strip(),
                    'ini': data_texto(ini), 'fim': data_texto(fim), 'dias': num(ws.cell(r, 7).value),
                    'previsto': num(ws.cell(r, 9).value) or 0, 'replanejado': num(ws.cell(r, 15).value)})
js = ['// Gerado a partir da planilha da Curva S (aba "BD - REV").',
      '// Não edite à mão: rode scripts/gerar-curva.py de novo, ou sincronize a pasta pelo painel.',
      'export const SEED_CURVA = ' + json.dumps(semanas, ensure_ascii=False, indent=0).replace('\n', '') + ';']
open(saida, 'w').write('\n'.join(js) + '\n')
print(len(semanas), 'semanas; previsto total', sum(s['previsto'] for s in semanas), semanas[0], semanas[-1])
