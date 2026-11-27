# Echivalentul Python al mock-server.mjs (pentru calculatoare fără Node).
# Rulează din rădăcina repo-ului: python mock_server.py   (PORT=8080, AUTHED=1 opțional)
import json, os, time, mimetypes
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs, unquote

ROOT = os.environ.get('ROOT') or os.getcwd()
state = {'authed': os.environ.get('AUTHED') == '1'}
INSTR = "Călește ceapa în puțin ulei.\nAdaugă carnea și rumenește 5 minute.\nPune legumele și apa, fierbe 30 de minute.\nAsezonează și servește cu smântână."

def R(id, name, cat, ing, img, paused=False):
    return {'id': id, 'name': name, 'category': cat, 'ingredients': ing, 'instructions': INSTR,
            'imageBlob': None if img is None else f'u/{img}.jpg', 'paused': paused}

recipes = [
    R('1', 'Ciorbă de perișoare', 'Ciorbe', ['500 g carne tocată', '1 ceapă', '2 morcovi', '1 ardei', '100 g orez', 'sare', 'piper', 'borș'], 0),
    R('2', 'Sarmale în foi de varză', 'Mâncăruri', ['1 varză murată', '700 g carne de porc', '1 ceapă', '100 g orez', 'cimbru', 'sare'], 1),
    R('3', 'Paste carbonara', 'Paste', ['400 g spaghete', '150 g guanciale', '4 ouă', '80 g pecorino', 'piper'], 2),
    R('4', 'Tocăniță de ciuperci', 'Mâncăruri', ['500 g ciuperci', '2 cepe', '2 linguri bulion', 'mărar', 'ulei'], 3),
    R('5', 'Salată de vinete', 'Salate', ['3 vinete', '1 ceapă', 'ulei', 'sare'], None),
    R('6', 'Pui la cuptor cu cartofi', 'Cuptor', ['1 pui', '1 kg cartofi', '4 căței de usturoi', 'rozmarin', 'ulei'], 4),
    R('7', 'Supă cremă de dovleac', 'Ciorbe', ['1 dovleac', '2 morcovi', '1 ceapă', '200 ml smântână', 'ghimbir'], 5),
    R('8', 'Ghiveci călugăresc', 'Mâncăruri', ['2 vinete', '3 ardei', '2 dovlecei', '1 ceapă', '3 roșii'], None, True),
    R('9', 'Clătite cu brânză', 'Desert', ['2 ouă', '250 ml lapte', '150 g făină', '250 g brânză dulce', 'zahăr'], 6),
    R('10', 'Mici la grătar', 'Grătar', ['1 kg carne mixtă', 'usturoi', 'cimbru', 'bicarbonat'], 7),
]
settings = {}  # documentul de setări al userului
plans = []  # planurile salvate, ca pe server (history/manual_plan)
IMPORTED = {'name': 'Zacuscă de casă', 'category': 'Conserve',
            'ingredients': ['2 kg vinete', '2 kg ardei kapia', '1 kg ceapă', '500 ml ulei'],
            'instructions': 'Coace vinetele și ardeii.\nCălește ceapa.\nAmestecă totul și fierbe 2 ore.'}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def send(self, status, body):
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('content-type', 'application/json; charset=utf-8')
        self.send_header('content-length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        n = int(self.headers.get('content-length') or 0)
        try:
            return json.loads(self.rfile.read(n) or b'{}')
        except Exception:
            return {}

    def handle_any(self):
        global recipes
        u = urlparse(self.path); p = u.path; q = parse_qs(u.query); m = self.command
        if p.startswith('/api/'):
            if p == '/api/auth/me':
                return self.send(200, {'user': {'id': 'u1', 'email': 'ioan@example.ro', 'name': 'Ioan'}}) if state['authed'] else self.send(401, {'error': 'No session'})
            if p in ('/api/auth/login', '/api/auth/register'):
                self.body(); state['authed'] = True; return self.send(200, {'user': {}})
            if p == '/api/auth/logout':
                state['authed'] = False; return self.send(200, {})
            if not state['authed']:
                return self.send(401, {'error': 'No session'})
            if p == '/api/recipes':
                if m == 'GET': return self.send(200, recipes)
                b = self.body()
                if m == 'POST':
                    it = {**b, 'id': str(int(time.time() * 1000))}; recipes.insert(0, it); return self.send(201, it)
                if m == 'PUT':
                    r = next((x for x in recipes if x['id'] == b.get('id')), None)
                    if r is None: return self.send(404, {'error': 'nf'})
                    r.update(b); return self.send(200, r)
                if m == 'DELETE':
                    rid = q.get('id', [''])[0]; recipes = [x for x in recipes if x['id'] != rid]; return self.send(200, {'ok': True})
            if p == '/api/view-url':
                n = q.get('blob', [''])[0].split('/')[-1]; return self.send(200, {'url': '/mockimg/' + n})
            if p == '/api/plan-latest':
                return self.send(200, plans[-1]) if plans else self.send(404, {'error': 'No saved plan found'})
            if p == '/api/plan-save':
                b = self.body(); now = time.time()
                doc = {'id': f'plan_{int(now*1000)}', 'createdAt': time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(now)) + f'.{int(now*1000)%1000:03d}Z', 'plan': b.get('plan', [])}
                plans.append(doc); return self.send(200, {'ok': True, 'id': doc['id']})
            if p == '/api/settings':
                if m == 'PUT':
                    b = self.body()
                    for k in ('excl', 'vegDays', 'veganDays', 'shopChecked'):
                        if k in b: settings[k] = b[k]
                    settings['updatedAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()) + str(time.time())
                return self.send(200, {'settings': settings or None})
            if p == '/api/usage/today': return self.send(200, {'calls': 2})
            if p in ('/api/import-image', '/api/import'):
                self.body(); time.sleep(0.6); return self.send(200, IMPORTED)
            return self.send(404, {'error': 'nf'})
        if p.startswith('/mockimg/'):
            f = os.path.join(ROOT, 'images', 'logo-appetora.png')
        else:
            f = os.path.normpath(os.path.join(ROOT, 'index.html' if p == '/' else unquote(p).lstrip('/')))
            if not f.startswith(os.path.normpath(ROOT)): f = ''
        try:
            with open(f, 'rb') as fh: data = fh.read()
        except Exception:
            self.send_response(404); self.end_headers(); return
        ext = os.path.splitext(f)[1].lower()
        ct = {'.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg'}.get(ext) or mimetypes.guess_type(f)[0] or 'application/octet-stream'
        self.send_response(200); self.send_header('content-type', ct); self.send_header('content-length', str(len(data))); self.end_headers(); self.wfile.write(data)

    do_GET = do_POST = do_PUT = do_DELETE = handle_any


if __name__ == '__main__':
    port = int(os.environ.get('PORT') or 8080)
    print(f'Appetora mock pe http://localhost:{port} (ROOT={ROOT})', flush=True)
    ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
