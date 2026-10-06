"""In-memory browser bridge; user access is enforced by the private Sites gateway."""
import base64
import time
import uuid


class BrowserBridgeError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


class GoogleBrowserBridge:
    def __init__(self):
        self.session = None
        self.last_agent_at = 0

    def expire(self):
        if self.session and time.monotonic() > self.session['expires']:
            if self.session['phase'] not in ('closed', 'expired', 'committed'):
                self.session.update(phase='expired', frame=None, artifact=None, commands=[{'operation':'cancel'}])

    def start(self):
        self.expire()
        if self.session and self.session['phase'] not in ('closed','expired','committed','error'):
            return self.view()
        self.session = {'id':str(uuid.uuid4()),'phase':'starting','expires':time.monotonic()+900,
                        'frame':None,'artifact':None,'commands':[{'operation':'start'}]}
        return self.view()

    def view(self):
        self.expire()
        return {'id':self.session['id'] if self.session else None,
                'phase':self.session['phase'] if self.session else 'closed',
                'agent_online':time.monotonic()-self.last_agent_at < 15,
                'width':1024,'height':768,
                'notice':self.session.get('notice') if self.session else None,
                'host':self.session.get('host') if self.session else None,
                'frame':self.session['frame'] if self.session else None}

    def input(self, value):
        self.expire()
        if not isinstance(value,dict) or not self.session or value.get('id') != self.session['id']:
            raise BrowserBridgeError('browser_session_missing')
        operation=value.get('operation')
        if operation=='cancel':
            self.session.update(phase='closed',frame=None,artifact=None,commands=[{'operation':'cancel'}])
            return self.view()
        if self.session['phase'] != 'interactive':
            raise BrowserBridgeError('browser_not_ready')
        if len(self.session['commands']) >= 64:
            raise BrowserBridgeError('input_queue_full')
        if operation=='click' and all(isinstance(value.get(k),int) and 0 <= value[k] < bound for k,bound in [('x',1024),('y',768)]):
            command={'operation':'click','x':value['x'],'y':value['y']}
        elif operation=='text' and isinstance(value.get('text'),str) and 1 <= len(value['text']) <= 4096:
            command={'operation':'text','text':value['text']}
        elif operation=='key' and value.get('key') in {'Enter','Tab','Backspace','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Escape','Home','End'}:
            command={'operation':'key','key':value['key']}
        elif operation=='scroll' and isinstance(value.get('delta'),int) and abs(value['delta'])<=2000:
            command={'operation':'scroll','delta':value['delta']}
        elif operation=='finish':
            command={'operation':'finish'}
            self.session['phase']='saving'
        else:
            raise BrowserBridgeError('invalid_browser_input')
        self.session['commands'].append(command)
        return {'phase':self.session['phase']}

    def agent(self, value):
        self.last_agent_at=time.monotonic()
        self.expire()
        if not isinstance(value,dict):raise BrowserBridgeError('invalid_agent_input')
        if self.session and value.get('id') == self.session['id'] and self.session['phase'] not in ('expired','closed','committed'):
            if value.get('host') in {'accounts.google.com','bundlefoundry.com','myaccount.google.com','support.google.com'}:
                self.session['host']=value['host']
            if value.get('phase') in ('interactive','error','captured'):
                # A frame arriving after Finish must not revert the saving phase.
                if self.session['phase']!='saving' or value['phase']!='interactive':
                    self.session['phase']=value['phase']
            if value.get('notice')=='login_not_completed':
                self.session.update(phase='interactive',notice='login_not_completed')
            elif value.get('phase')=='captured':
                self.session.pop('notice',None)
            frame=value.get('frame')
            if frame is not None:
                try:
                    decoded=base64.b64decode(frame,validate=True)
                    if len(decoded)>300000 or not decoded.startswith(b'\xff\xd8'):raise ValueError()
                except Exception:raise BrowserBridgeError('invalid_browser_frame') from None
                self.session['frame']=frame
            if value.get('artifact') is not None:
                artifact=value['artifact']
                if not isinstance(artifact,dict) or artifact.get('version')!=1:
                    raise BrowserBridgeError('invalid_browser_artifact')
                self.session.update(artifact=artifact,frame=None,phase='captured')
        if not self.session:return {'id':None,'commands':[]}
        commands=self.session['commands']
        self.session['commands']=[]
        return {'id':self.session['id'],'commands':commands,'phase':self.session['phase']}

    def artifact(self):
        self.expire()
        if not self.session or self.session['phase']!='captured' or not self.session['artifact']:
            raise BrowserBridgeError('browser_authorization_not_saved')
        return self.session['artifact']

    def committed(self):
        self.session.update(phase='committed',artifact=None,frame=None,commands=[])
