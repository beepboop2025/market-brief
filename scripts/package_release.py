#!/usr/bin/env python3
"""Create deterministic skill and plugin archives from an explicit Git revision."""
import argparse
import hashlib
import io
import pathlib
import subprocess
import tarfile
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ref', required=True)
    parser.add_argument('--output', default='artifacts/release')
    args = parser.parse_args()
    # Resolve an immutable commit first; never archive uncommitted working files.
    revision = subprocess.check_output(['git','rev-parse','--verify',args.ref+'^{commit}'],cwd=ROOT,text=True).strip()
    archive = subprocess.check_output(['git','archive','--format=tar',revision],cwd=ROOT)
    files = {}
    with tarfile.open(fileobj=io.BytesIO(archive)) as source:
        for entry in source.getmembers():
            if entry.isfile():
                files[entry.name] = source.extractfile(entry).read()
    for name in ('LICENSE','THIRD_PARTY_NOTICES.md'):
        assert files[name] == files['skills/market-brief/'+name], name+' missing from standalone skill'
    targets = {
        'market-brief-skill-0.1.0.zip': {name.removeprefix('skills/'): body for name,body in files.items() if name.startswith('skills/market-brief/')},
        'market-brief-plugin-0.1.0.zip': {name:body for name,body in files.items() if name.startswith(('skills/','.codex-plugin/','assets/')) or name in ('.claude-plugin/plugin.json','.mcp.json','LICENSE','THIRD_PARTY_NOTICES.md','README.md')},
    }
    output = pathlib.Path(args.output);output.mkdir(parents=True,exist_ok=True)
    checksums = []
    for name,contents in targets.items():
        destination=output/name
        with zipfile.ZipFile(destination,'w',compression=zipfile.ZIP_DEFLATED) as z:
            for file,body in sorted(contents.items()):
                info=zipfile.ZipInfo(file,date_time=(2026,9,6,0,0,0))
                info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16
                z.writestr(info,body)
        checksums.append(hashlib.sha256(destination.read_bytes()).hexdigest()+'  '+name)
    (output/'SHA256SUMS').write_text('\n'.join(checksums)+'\n')
    (output/'SOURCE_COMMIT').write_text(revision+'\n')
    print(revision)
    print('\n'.join(checksums))

if __name__ == '__main__':
    main()
