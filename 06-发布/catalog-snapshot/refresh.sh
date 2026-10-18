#!/usr/bin/env bash
# 重新生成对客静态目录快照（数据经四眼发布后执行，随后部署 CF Pages）。
set -e
cd "$(dirname "$0")"
API="${1:-https://tip-api-niy0.onrender.com}"
/opt/python3.12/bin/python3 - "$API" <<'PY'
import urllib.request,json,sys
B=sys.argv[1]
H={'x-tip-realm':'staff','x-tip-user':'admin01'}
def get(p):
    req=urllib.request.Request(B+p,headers=H)
    with urllib.request.urlopen(req,timeout=90) as r:
        return json.load(r)
projs=get('/v1/catalog/projects')['records']
fees=[]
for p in projs:
    fid=p.get('feeScheduleId')
    if fid: fees.append(get(f'/v1/catalog/fee-schedules/{fid}'))
json.dump({'records':projs,'snapshotAt':'2026-10-18'},open('projects.json','w'),ensure_ascii=False,indent=1)
json.dump({'records':fees,'snapshotAt':'2026-10-18'},open('fee-schedules.json','w'),ensure_ascii=False,indent=1)
print('snapshot:',len(projs),'projects,',len(fees),'fee schedules')
PY
