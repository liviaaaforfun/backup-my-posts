# 把 template/ 內容打包成 lib/templates.js，讓工具可以直接從電腦打開（file://）使用
import json, pathlib
t = {n: pathlib.Path('template', n).read_text(encoding='utf-8') for n in ('index.html', 'site.css', 'site.js')}
pathlib.Path('lib/templates.js').write_text('// 自動產生，請改 template/ 後執行 python3 build_templates.py\nwindow.TEMPLATES=' + json.dumps(t, ensure_ascii=False) + ';\n', encoding='utf-8')
print('ok', {k: len(v) for k, v in t.items()})
