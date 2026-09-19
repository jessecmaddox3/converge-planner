#!/usr/bin/env python3
"""Exercise the real local fictional app. Never target a hosted installation."""
import json,os,re,urllib.parse
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
ORIGIN=os.environ.get('CONVERGE_TEST_ORIGIN','http://127.0.0.1:5075').rstrip('/')
assert urllib.parse.urlparse(ORIGIN).hostname in ('127.0.0.1','localhost'),'Local fictional test only'
OUT=ROOT/'artifacts/browser';OUT.mkdir(parents=True,exist_ok=True)
def main():
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True)
  external=[];errors=[];checks=[];shots=[]
  def context():
   c=browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True)
   def route(r):
    if r.request.url.startswith(ORIGIN+'/'):r.continue_()
    else:external.append(r.request.url);r.abort()
   c.route('**/*',route)
   c.on('page',lambda page:page.on('pageerror',lambda error:errors.append(str(error))))
   return c
  def visit(page,url):page.goto(ORIGIN+url);page.wait_for_load_state('networkidle')
  def persona(page,person):
   with page.expect_navigation(wait_until='networkidle'):
    page.get_by_role('combobox').select_option(person)
  def snapshot(page,name):
   for width in (320,390,768,1440):
    page.set_viewport_size({'width':width,'height':1000})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 2'),f'Page overflow: {name} at {width}'
    file=OUT/f'{name}-{width}.png';page.screenshot(path=str(file),full_page=True);shots.append(file.name)
   page.set_viewport_size({'width':1440,'height':1000})
  def api(page,url,method='GET',body=None,actor=None):
   return page.evaluate('''async ({url,method,body,actor})=>{const r=await fetch(url,{method,headers:{'Content-Type':'application/json','X-Converge-Actor':actor??document.body.dataset.actor},...(body===null?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json()}}''',{'url':url,'method':method,'body':body,'actor':actor})
  c=context();page=c.new_page();visit(page,'/demo');persona(page,'quinn')
  href=page.get_by_role('link',name='manage the Orchard sketching weekend').get_attribute('href');trip=href.rsplit('/',1)[1]
  visit(page,'/');expect(page.get_by_role('link',name=re.compile('Orchard sketching weekend'))).to_contain_text('May 1 to May 31');snapshot(page,'home')
  visit(page,href)
  if page.get_by_role('button',name='Reopen availability').count():page.get_by_role('button',name='Reopen availability').click();expect(page.get_by_role('button',name=re.compile('^Review May'))).to_be_visible()
  if page.get_by_role('button',name='Open responses',exact=True).count():page.get_by_role('button',name='Open responses',exact=True).click();expect(page.get_by_role('button',name='Close responses',exact=True)).to_be_visible()
  snapshot(page,'comparison')
  # Keep the old tab's session refresh deliberately delayed, reproducing the race.
  visit(page,'/demo');persona(page,'reed');visit(page,'/join/'+trip)
  expect(page.get_by_role('button',name='Update availability')).to_be_visible()
  old_actor=page.locator('body').get_attribute('data-actor')
  old_session=page.evaluate("async()=>await (await fetch('/api/auth/session')).json()")
  old_response=api(page,f'/api/trips/{trip}/me')['body']['response']
  page.route('**/api/auth/session*',lambda r:r.fulfill(json=old_session))
  other=c.new_page();visit(other,'/demo');persona(other,'morgan');visit(other,'/join/'+trip)
  before=api(other,f'/api/trips/{trip}/me')['body']['response']
  page.bring_to_front();page.get_by_role('button',name='Maybe: Friday, May 3').click()
  with page.expect_response(lambda r:r.url.endswith('/availability')) as changed:page.get_by_role('button',name='Update availability').click()
  assert changed.value.status==409
  expect(page.get_by_text('The account changed in another tab. Reload this page before continuing.')).to_be_visible()
  assert api(other,f'/api/trips/{trip}/me')['body']['response']==before
  assert api(page,'/api/calendars',actor=old_actor)['status']==409
  assert api(page,'/api/trips','POST',{},old_actor)['status']==409
  page.unroute('**/api/auth/session*');visit(page,'/demo');persona(page,'reed');visit(page,'/join/'+trip)
  assert api(page,f'/api/trips/{trip}/me')['body']['response']==old_response
  checks.append('stale two-tab availability/create/calendar rejected without changing either response')
  # Edit and persist the four availability states using the actual respondent UI.
  page.get_by_role('button',name='Maybe: Friday, May 3').click()
  page.get_by_role('button',name='Clear answer: Friday, May 10').click()
  page.get_by_role('button',name='Update availability').click();expect(page.get_by_text('Your availability is updated.')).to_be_visible()
  page.reload();expect(page.get_by_role('button',name='Maybe: Friday, May 3')).to_have_attribute('aria-pressed','true')
  page.get_by_role('button',name='Cannot: Friday, May 10').click()
  page.get_by_role('button',name='Available: Friday, May 3').click()
  page.get_by_role('button',name='Update availability').click();expect(page.get_by_text('Your availability is updated.')).to_be_visible();snapshot(page,'respond')
  checks.append('respondent choices persist and can be edited')
  # An anonymous form may not borrow another tab's newly signed-in email.
  anon=context();a=anon.new_page();visit(a,'/join/'+trip)
  expect(a.get_by_role('button',name='Save availability')).to_be_visible()
  a.get_by_role('textbox',name='Your name').fill('Invented Visitor')
  a.route('**/api/auth/session*',lambda r:r.fulfill(json={}))
  a2=anon.new_page();visit(a2,'/demo');persona(a2,'morgan')
  a.bring_to_front()
  with a.expect_response(lambda r:r.url.endswith('/availability')) as rejected:a.get_by_role('button',name='Save availability').click()
  assert rejected.value.status==409
  anon.close();checks.append('stale anonymous capability cannot acquire another account email')
  # Close responses, confirm and inspect the real persisted mail/ICS formatter.
  visit(page,'/demo');persona(page,'quinn');visit(page,href)
  if page.get_by_role('button',name='Close responses',exact=True).count():page.get_by_role('button',name='Close responses',exact=True).click();expect(page.get_by_role('button',name='Open responses',exact=True)).to_be_visible()
  page.get_by_role('button',name='Review May 17',exact=True).click()
  page.get_by_role('button',name='Confirm May 17',exact=True).click();expect(page.get_by_role('button',name='Reopen availability')).to_be_visible();snapshot(page,'confirmed')
  with page.expect_download() as download:page.get_by_role('button',name='Add to calendar').click()
  content=Path(download.value.path()).read_text();assert 'BEGIN:VCALENDAR' in content and 'converge-demo.invalid' in content
  page.get_by_role('link',name='Open preview outbox').click()
  expect(page.get_by_role('link',name='Open rendered email').first).to_be_visible(timeout=15000)
  email=page.get_by_role('link',name='Open rendered email').first
  with page.expect_popup() as popup:email.click()
  preview=popup.value;preview.wait_for_load_state();expect(preview.locator('body')).to_contain_text('Orchard sketching weekend');preview.close()
  with page.expect_download() as mail_download:page.get_by_role('link',name='Download calendar file').first.click()
  assert 'BEGIN:VCALENDAR' in Path(mail_download.value.path()).read_text()
  snapshot(page,'outbox');outbox_url=page.url;download_url=page.get_by_role('link',name='Download calendar file').first.get_attribute('href')
  visit(other,'/demo');persona(other,'taylor')
  assert other.request.get(ORIGIN+download_url).status==404
  visit(page,'/demo');persona(page,'quinn');visit(page,href)
  page.get_by_role('button',name='Reopen availability').click();expect(page.get_by_role('button',name='Close responses',exact=True)).to_be_visible()
  checks.append('close/confirm/outbox HTML and ICS owner checks/reopen lifecycle')
  # Full organizer calendar -> history -> shortlist -> share journey.
  visit(page,'/');page.get_by_role('textbox',name='What are you planning?').fill('Fictional browser planning workshop')
  page.get_by_role('button',name='Find dates').click()
  page.get_by_role('button',name=re.compile('^(Connect Google Calendar|Try fictional calendars)$')).click()
  expect(page.get_by_role('button',name='Check selected calendars')).to_be_visible()
  page.get_by_role('checkbox',name=re.compile('unavailable',re.I)).check()
  with page.expect_response(lambda r:'/api/calendar-scan' in r.url) as scan:page.get_by_role('button',name='Check selected calendars').click()
  assert scan.value.status==200 and scan.value.json()['current']['coverage']['status']=='partial'
  page.get_by_role('button',name='Load past calendar events').click();expect(page.get_by_role('button',name=re.compile('simulated|Group related'))).to_be_visible()
  with page.expect_response(lambda r:'/api/summarize-history' in r.url) as grouping:page.get_by_role('button',name=re.compile('simulated|Group related')).click()
  assert 'simulation' in grouping.value.json()['model'].lower()
  page.get_by_role('button',name='Suggest 3 separate options').click();snapshot(page,'date-explorer')
  page.get_by_role('button',name='Create invitation').click();page.wait_for_url('**/manage/*');expect(page.get_by_role('heading',name='Fictional browser planning workshop')).to_be_visible()
  created=page.url;page.reload();expect(page.get_by_role('heading',name='Fictional browser planning workshop')).to_be_visible()
  checks.append('actual organizer creation, partial calendar coverage, simulated grouping, persisted management')
  assert not external,external
  assert not errors,errors
  report={'checks':checks,'screenshots':shots,'externalRequests':external,'pageErrors':errors,'createdTripUrl':created,'outboxUrl':outbox_url}
  (OUT/'results.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
  browser.close()
if __name__=='__main__':main()
