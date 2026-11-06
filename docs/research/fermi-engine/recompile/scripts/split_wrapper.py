import json, os, sys
R = sys.argv[1]
d = json.load(open(R + '/ref/wrapper.json'))
print(d.get('compiler_version'), d.get('optimization_runs'), d.get('evm_version'))
print(json.dumps(d.get('compiler_settings'))[:600])
os.makedirs(R + '/ref/src', exist_ok=True)
files = [{'file_path': d['file_path'], 'source_code': d['source_code']}] + d.get('additional_sources', [])
for f in files:
    p = R + '/ref/src/' + f['file_path'].replace('/', '__')
    open(p, 'w').write(f['source_code'])
    print(f['file_path'], len(f['source_code']))
