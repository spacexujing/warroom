import asyncio,json,os,shutil,subprocess,tempfile,time
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
TEMP=Path(tempfile.mkdtemp(prefix='warroom-browser-'))
OUT=Path(os.environ.get('WARROOM_SCREENSHOTS',str(TEMP/'screenshots')));OUT.mkdir(parents=True,exist_ok=True)
PORT=int(os.environ.get('WARROOM_TEST_PORT','18343'))
URL=f'http://127.0.0.1:{PORT}'
SERVER=None
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE') or shutil.which('chromium'),args=['--no-sandbox'])
  page=await browser.new_page(viewport={'width':1440,'height':1000}); errors=[];page.on('pageerror',lambda err:errors.append(str(err)))
  await page.goto(URL+'/'); await page.wait_for_function('SERVER_STATE && SERVER_META && TERRITORIES && UNITS.length>0')
  observer=await browser.new_page();await observer.goto(URL+'/');await observer.wait_for_function('SERVER_STATE && SERVER_META')
  await page.wait_for_timeout(1000)
  await page.screenshot(type="jpeg",quality=55,path=str(OUT/'01-economy.jpg'))
  async def state():return await page.evaluate('JSON.parse(JSON.stringify(SERVER_STATE))')
  async def send(action,**payload):
   before=(await state())['revision'];await page.evaluate('(m)=>sendAction(m.action,m)',{'action':action,**payload});await page.wait_for_function('(r)=>SERVER_STATE.revision>r',arg=before,timeout=6000)
  if (await state())['phase']=='phase1_economy':
   await page.locator('#force-advance-tab').click();await page.locator('#force-advance-btn').click();await page.get_by_role('dialog',name='操作预览').wait_for();assert '执行操作' in await page.get_by_role('dialog',name='操作预览').inner_text();await page.get_by_role('button',name='执行操作',exact=True).click();await page.wait_for_function('SERVER_STATE.phase==="phase2_planning"')
  await send('set_order',nation='germany',index=0,order={'formationId':'germany-land-22','dest':'R4'})
  expected=(await state())['revision'];await observer.wait_for_function('(r)=>SERVER_STATE.revision===r',arg=expected)
  await send('start_turn_order')
  while not (g:=await state())['turnOrder']['done']:
   to=g['turnOrder'];await send('pick_slot',nation=to['queue'][to['currentIndex']],slot=['germany','soviet','japan','britain','usa','italy','china'].index(to['queue'][to['currentIndex']]))
  await send('force_confirm');await page.evaluate('selectNation("germany")');await page.wait_for_timeout(300);await page.screenshot(type="jpeg",quality=55,path=str(OUT/'02-movement.jpg'))
  await send('resolve_order',nation='germany',result='execute');assert (await state())['units']['germany-land-22']['code']=='R4'
  await send('force_confirm');g=await state();print('hotspots',[(x['id'],x['nations']) for x in g['combat']['pending']])
  current=g['combat']['picker'];task=next(x for x in g['combat']['pending'] if current in x['nations']);await page.evaluate('(n)=>selectNation(n)',current);await send('choose_battle',nation=current,battleId=task['id']);await page.wait_for_timeout(400);await page.screenshot(type="jpeg",quality=55,path=str(OUT/'03-battle-setup.jpg'))
  await page.locator('#action-content').get_by_role('button',name='地图定位').click();await page.wait_for_timeout(650)
  await send('start_battle',nation=current)
  for _ in range(150):
   g=await state();b=g['combat']['current']
   if b['step']=='report':break
   if b['step']=='roll':await send('roll_combat',nation=b['commanders'][b['turn']])
   elif b['step']=='hits':await send('assign_hit',nation=b['commanders'][b['dice']['side']],tokenId=b['legalTargets'][0])
   elif b['step']=='garrison_hit':await send('assign_hit',nation=current,tokenId=b['garrisonTargets'][0])
   else:raise Exception('unexpected '+b['step'])
  await page.evaluate('(n)=>selectNation(n)',current);await page.wait_for_timeout(300);await page.screenshot(type="jpeg",quality=55,path=str(OUT/'04-battle-report.jpg'))
  await page.get_by_role('button',name='预览战斗报告',exact=True).click();await page.get_by_role('dialog',name='操作预览').wait_for();await page.get_by_role('button',name='执行操作',exact=True).click();await page.wait_for_function('SERVER_STATE.combat.current===null')
  while (g:=await state())['combat']['pending']:
   current=g['combat']['picker'];task=next(x for x in g['combat']['pending'] if current in x['nations']);await send('choose_battle',nation=current,battleId=task['id'])
   if task['kind']=='convoy':
    await send('roll_convoy',nation=current);b=(await state())['combat']['current'];await send('finish_convoy',nation=current,blackColors=['yellow']*b['dice'].count('black'))
   else:
    await send('start_battle',nation=current)
    for _ in range(200):
     b=(await state())['combat']['current']
     if b['step']=='report':break
     if b['step']=='roll':await send('roll_combat',nation=b['commanders'][b['turn']])
     elif b['step']=='hits':await send('assign_hit',nation=b['commanders'][b['dice']['side']],tokenId=b['legalTargets'][0])
     elif b['step']=='garrison_hit':await send('assign_hit',nation=current,tokenId=b['garrisonTargets'][0])
     else:raise Exception('unexpected '+b['step'])
    await send('finish_battle',nation=current)
  await send('force_confirm')
  for u in list((await state())['units'].values()):
   if u.get('needsLanding'):
    g=await state();options=g['landingOptions'][u['id']]
    await send('land_air',nation=u['nation'],unitId=u['id'],**({'code':options[0]} if options else {'destroy':True}))
  await send('force_confirm')
  g=await state();assert g['phase']=='phase6_morale';await page.screenshot(type="jpeg",quality=55,path=str(OUT/'05-morale.jpg'))
  for _ in range(40):
   g=await state();m=g['morale']
   if m['step']=='done':break
   nation=next(n for n in g['roundOrder'] if not g['nations'][n]['collapsed'] and n not in m['submitted']);payload={'nation':nation,'step':m['step']}
   if m['step']=='penalty':
    n=g['nations'][nation];need=min(3,sum(n['resources'].values())) if n['zone']>=1 else 0;paid={'oil':0,'iron':0,'osr':0}
    for k in ['osr','iron','oil']:take=min(need,n['resources'][k]);paid[k]=take;need-=take
    payload['payment']=paid
   if m['step']=='desert':payload['losses']=[]
   await send('morale_submit',**payload)
  await send('force_confirm');await page.evaluate('selectNation("germany")');await page.wait_for_timeout(300);await page.screenshot(type="jpeg",quality=55,path=str(OUT/'06-production.jpg'))
  await page.locator('#action-content').get_by_label('数量',exact=True).fill('2');await page.locator('#action-content').get_by_role('button',name='加入清单',exact=True).click();await page.screenshot(type='jpeg',quality=55,path=str(OUT/'06-production.jpg'))
  await page.locator('#action-content').get_by_role('button',name='预览并保存清单',exact=True).click();await page.get_by_role('dialog',name='操作预览').wait_for();await page.screenshot(type='jpeg',quality=55,path=str(OUT/'06-production-preview.jpg'));await page.get_by_role('button',name='执行操作',exact=True).click();await page.wait_for_function('SERVER_STATE.productionDrafts.germany && SERVER_STATE.productionDrafts.germany.items[0].count===2');await send('force_confirm');assert (await state())['round']==2
  await page.locator('#open-reports').click();await page.screenshot(type="jpeg",quality=55,path=str(OUT/'07-settlement-history.jpg'))
  # Malformed HTTP input returns a client error and leaves the process healthy.
  res=await page.request.get(URL+'/%ZZ');assert res.status==400;assert (await page.request.get(URL+'/api/state')).status==200
  for index, viewport in enumerate([{'width':844,'height':390},{'width':640,'height':360},{'width':390,'height':844}]):
   mobile=await browser.new_page(viewport=viewport,is_mobile=True,has_touch=True);mobile.on('pageerror',lambda err:errors.append(str(err)));await mobile.goto(URL+'/');await mobile.wait_for_function('SERVER_STATE && SERVER_META && mapReady');await mobile.wait_for_timeout(400)
   bounds=await mobile.locator('#action-panel').bounding_box()
   assert bounds['x']>0 and bounds['y']<=1 and bounds['width']<=280 and bounds['height']>=viewport['height']-1
   assert bounds['x']+bounds['width']<=viewport['width']+1
   await mobile.screenshot(type="jpeg",quality=55,path=str(OUT/f'{8+index:02}-mobile.jpg'))
   await mobile.locator('#action-toggle').click();assert await mobile.locator('#action-panel').evaluate('(e)=>e.classList.contains("collapsed")')
  print('browser_errors',errors);assert not errors
  print('PASS: complete round, two synchronized clients, previews, HTTP errors and mobile layout; screenshots:',OUT)
  await browser.close()
if __name__=='__main__':
 SERVER=subprocess.Popen(['node',str(ROOT/'server.js')],cwd=ROOT,env={**os.environ,'PORT':str(PORT),'WARROOM_SAVE_PATH':str(TEMP/'game.json')},stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 try:
  time.sleep(0.4)
  asyncio.run(main())
 finally:
  SERVER.terminate()
  try:SERVER.wait(timeout=3)
  except subprocess.TimeoutExpired:SERVER.kill();SERVER.wait()
