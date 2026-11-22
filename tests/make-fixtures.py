"""Builds small StarDict / TSV fixtures (zip, tar.xz, tar.gz) for tests/dict.test.js — no network needed."""
import gzip, io, os, struct, tarfile, zipfile

OUT = os.path.join(os.path.dirname(__file__), 'fixtures')
os.makedirs(OUT, exist_ok=True)

def build_stardict(name, entries, seq=None, off64=False, syn=None, bookname='Test dict'):
    """entries: list of (headword, [(type, bytes_or_str), ...]) sorted like StarDict wants (by lower-case)."""
    entries = sorted(entries, key=lambda e: e[0].lower())
    dict_buf = bytearray(); idx = bytearray(); offsets = {}
    for word, fields in entries:
        art = bytearray()
        for i, (t, data) in enumerate(fields):
            data = data.encode('utf-8') if isinstance(data, str) else data
            last = i == len(fields) - 1
            if seq is None:
                art += t.encode()                               # per-field type byte
                if t.isupper(): art += struct.pack('>I', len(data)) + data
                else: art += data + b'\0'
            else:
                if t.isupper() and not last: art += struct.pack('>I', len(data)) + data
                elif last: art += data
                else: art += data + b'\0'
        offsets[word] = len(dict_buf)
        idx += word.encode('utf-8') + b'\0'
        idx += struct.pack('>Q' if off64 else '>I', len(dict_buf)) + struct.pack('>I', len(art))
        dict_buf += art
    ifo = "StarDict's dict ifo file\nversion=2.4.2\nbookname=%s\nwordcount=%d\nidxfilesize=%d\n" % (bookname, len(entries), len(idx))
    if seq: ifo += 'sametypesequence=%s\n' % seq
    if off64: ifo += 'idxoffsetbits=64\n'
    files = {name + '.ifo': ifo.encode(), name + '.idx': bytes(idx), name + '.dict.dz': gzip.compress(bytes(dict_buf))}
    if syn:
        heads = [e[0] for e in entries]; sb = bytearray()
        for s, target in sorted(syn):
            sb += s.encode() + b'\0' + struct.pack('>I', heads.index(target))
        files[name + '.syn'] = bytes(sb)
    return files

# WikDict-like: HTML articles (sametypesequence=h), synonyms
wik = build_stardict('eng-deu', [
    ('dog',   [('h', '<ol><li>Hund</li><li>Rüde</li></ol>')]),
    ('Café',  [('h', '<i>/kaˈfeː/</i> Kaffeehaus; <b>Café</b>')]),
    ('Straße', [('h', 'street &amp; road<br>Weg')]),
    ('house', [('h', '<span class="ipa">haʊs</span><ol><li>Haus</li></ol>')]),
    ('house', [('h', '<ol><li>Gebäude</li></ol>')]),
], seq='h', syn=[('dogs', 'dog'), ("dog's", 'dog')], bookname='WikDict eng-deu')

# FreeDict-like: plain text 'm' articles with a leading /ipa/
free = build_stardict('eng-fra', [
    ('cat',   [('m', '/kæt/\n  chat')]),
    ('water', [('m', '[ˈwɔːtə]\n  eau')]),
], seq='m', bookname='FreeDict eng-fra')

# No sametypesequence + phonetic field + 64-bit offsets
nots = build_stardict('rus-eng', [
    ('книга', [('t', 'knʲiɡə'), ('m', 'book')]),
    ('вода',  [('t', 'vɐˈda'), ('m', 'water')]),
], seq=None, off64=True, bookname='rus-eng')

with zipfile.ZipFile(os.path.join(OUT, 'wikdict-eng-deu.zip'), 'w', zipfile.ZIP_DEFLATED) as z:
    for k, v in wik.items(): z.writestr(k, v)

def tar_to(path, mode, files, prefix):
    with tarfile.open(path, mode) as t:
        for k, v in files.items():
            ti = tarfile.TarInfo(prefix + '/' + k); ti.size = len(v); t.addfile(ti, io.BytesIO(v))
tar_to(os.path.join(OUT, 'freedict-eng-fra.tar.xz'), 'w:xz', free, 'eng-fra')
tar_to(os.path.join(OUT, 'freedict-eng-fra.tar.gz'), 'w:gz', free, 'eng-fra')
with zipfile.ZipFile(os.path.join(OUT, 'freedict-eng-fra.zip'), 'w') as z:
    for k, v in free.items(): z.writestr('eng-fra/' + k, v)
with zipfile.ZipFile(os.path.join(OUT, 'rus-eng.zip'), 'w') as z:
    for k, v in nots.items(): z.writestr(k, v)

open(os.path.join(OUT, 'local.tsv'), 'w', encoding='utf-8').write(
    "apple\t/ˈæp.əl/\tяблоко\nBread\t/bred/\tхлеб\nbad line without tabs\n\nCafé\t\tкафе; кофейня\n")
print('fixtures:', sorted(os.listdir(OUT)))
