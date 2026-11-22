"""Keep the local update key outside the project. Only sign the APK explicitly supplied by the build."""
import argparse, os, secrets, subprocess
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('input',type=Path);p.add_argument('out',type=Path);p.add_argument('keytool');p.add_argument('signer');args=p.parse_args()
os.umask(0o077)
folder=Path(os.environ.get('MARKETLAB_ANDROID_SIGNING_DIR',Path.home()/'.marketlab/android-signing'))
folder.mkdir(mode=0o700,parents=True,exist_ok=True)
key=folder/'marketlab-release.p12'; secret=folder/'password'
if key.exists() and not secret.is_file():raise SystemExit('The existing signing key has no local password file; restore its matching credentials.')
if not secret.exists():
    with secret.open('x') as f:f.write(secrets.token_urlsafe(48))
env={**os.environ,'ML_SIGN_PASSWORD':secret.read_text().strip()}
if not key.exists():
    subprocess.run([args.keytool,'-genkeypair','-alias','marketlab','-keystore',str(key),'-storetype','PKCS12','-storepass:env','ML_SIGN_PASSWORD','-keypass:env','ML_SIGN_PASSWORD','-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=MarketLab Local Android Releases'],env=env,check=True)
key.chmod(0o600);secret.chmod(0o600)
args.out.parent.mkdir(parents=True,exist_ok=True)
subprocess.run([args.signer,'sign','--ks',str(key),'--ks-key-alias','marketlab','--ks-pass','env:ML_SIGN_PASSWORD','--v4-signing-enabled','false','--out',str(args.out),str(args.input)],env=env,check=True)
args.out.chmod(0o644)
subprocess.run([args.signer,'verify','--verbose','--print-certs',str(args.out)],env=env,check=True)
