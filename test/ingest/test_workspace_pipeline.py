"""Exercise generated workspace manifests through both pipeline phases."""
import json
import subprocess
import sys
import tomllib
import wave
from pathlib import Path

import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / '.github/scripts'))
from ingest import pipeline, organize, review, websearch
from lib.meta_parser import parse_meta_text


def materialize(root, draft, assets):
    result = subprocess.run(['node', '--input-type=module', '-e',
        "import {workspaceManifest} from './functions/api/workspaceManifest.js'; let input=''; for await(const part of process.stdin) input+=part; const {draft,assets}=JSON.parse(input); process.stdout.write(workspaceManifest(draft,assets));"],
        input=json.dumps({'draft': draft, 'assets': assets}), text=True, capture_output=True, cwd=ROOT, check=True)
    root.mkdir(parents=True, exist_ok=True)
    (root / 'manifest.toml').write_text(result.stdout, encoding='utf-8')
    return tomllib.loads(result.stdout)


def audio(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), 'wb') as source:
        source.setparams((1, 2, 8000, 0, 'NONE', 'not compressed'))
        source.writeframes(b'\0\0' * 8000)


@pytest.fixture
def external(monkeypatch):
    monkeypatch.setattr(websearch, 'available', lambda: False)
    monkeypatch.setattr(pipeline, 'extract_audio_meta', lambda _: ({}, ''))
    monkeypatch.setattr(pipeline, 'apply_audio_tag_metadata', lambda *args: None)
    monkeypatch.setattr(pipeline, 'extract_embedded_cover', lambda *args: None)
    monkeypatch.setattr(organize, 'llm_order_tracks', lambda names, album: [
        {'order': index + 1, 'file': name, 'title': Path(name).stem, 'inst': False} for index, name in enumerate(names)])


def test_workspace_roles_multi_audio_links_inst_cover_and_meta_reach_review(tmp_path, monkeypatch, external):
    source = tmp_path / 'payload' / '专辑'
    assets = [
        {'path': '01.wav', 'role': 'song'}, {'path': '02.wav', 'role': 'song'},
        {'path': 'book.png', 'role': 'photo', 'linkTo': [1, 2]},
        {'path': 'credits.png', 'role': 'photo', 'linkTo': ['SP']},
        {'path': 'staff.txt', 'role': 'staff'}, {'path': 'ignored.wav', 'role': 'etc'},
        {'path': 'art/front.png', 'role': 'cover'},
    ]
    materialize(source, {'album': '专辑', 'meta': {'vocal': ['Singer "A", B'], 'year': '2026', 'lyric_maker': ['Manual']},
        'names': {'zh_name': '专辑"\\\n名'}, 'tracks': [{'order': 1, 'audio': '01.wav', 'inst': False}, {'order': 2, 'file': '02.wav', 'inst': True}]}, assets)
    for name in ['01.wav', '02.wav', 'ignored.wav']:
        audio(source / name)
    for name in ['book.png', 'credits.png', 'art/front.png']:
        (source / name).parent.mkdir(parents=True, exist_ok=True)
        Image.new('RGB', (2, 2), 'white').save(source / name)
    (source / 'staff.txt').write_text('作词：StaffPerson\n', encoding='utf-8')
    called = {'stt': [], 'ocr': [], 'vision': []}
    def stt(path):
        called['stt'].append(path.name)
        return ([{'start': 0.1, 'end': 0.8, 'text': 'hello'}], 'en', {}, 1)
    def ocr(images):
        called['ocr'].extend(path.name for path in images)
        return {path.name: '作曲：ComposerName\n' for path in images}
    def vision(images, tracks, links):
        called['vision'].append(([path.name for path in images], links))
        return {'assignments': {'1': 'hello', '2': 'hello'}, 'pages': [{'name': 'book.png', 'text': 'hello'}], 'meta': {}}
    monkeypatch.setattr(pipeline.stt_mod, 'transcribe_words', stt)
    monkeypatch.setattr(pipeline.ocr_mod, 'run', ocr)
    monkeypatch.setattr(organize, 'llm_assign_booklet_vision', vision)
    result = pipeline.run_phase_a(source.parent, tmp_path/'res', tmp_path/'work', '', tmp_path/'bundle', lyric_maker='Required', lyric_makers=['Manual', 'Editor'])
    assert result['result'] == 'ok'
    draft = review.read_bundle(tmp_path/'bundle'/'专辑')
    assert called['stt'] == ['01.wav']
    assert called['ocr'] == ['credits.png']
    assert called['vision'][0][0] == ['book.png']
    assert draft['tracks'][1]['inst'] is True
    assert draft['meta']['lyricist'] == ['StaffPerson']
    assert draft['meta']['composer'] == ['ComposerName']
    assert draft['meta']['lyric_maker'] == ['Manual', 'Editor', 'Required']
    assert draft['pages'][0]['linked_track_orders'] == [1, 2]
    assert Path(draft['cover_path']).read_bytes() == (source/'art/front.png').read_bytes()
    pipeline.run_phase_b(tmp_path/'bundle', tmp_path/'res')
    text = (tmp_path/'res'/'专辑'/'meta.toml').read_text()
    parsed = tomllib.loads(text)
    assert parsed['演唱'] == ['Singer "A", B']
    assert parsed['中文名'] == '专辑"\\\n名'
    assert parse_meta_text(text)['vocal'] == ['Singer "A", B']
    assert parse_meta_text(text)['zh_name'] == parsed['中文名']
    assert not list((tmp_path/'res').rglob('*.klrc'))


def test_manual_multivocal_elrc_survives_phase_a_review_and_phase_b(tmp_path, monkeypatch, external):
    source = tmp_path/'payload'/'Album'
    materialize(source, {'album':'Album', 'tracks':[], 'meta':{}}, [])
    lrc = '[ti:Original]\r\n[00:01.000]Main\r\n[00:01.500]Harmony\r\n'
    elrc = '[ti:Edited title]\n[00:01.000]<00:01.050>Main\n[00:01.500]<00:01.640>Harmony\n'
    (source/'song.lrc').write_bytes(lrc.encode())
    (source/'song.elrc').write_bytes(elrc.encode())
    audio(source/'song.wav')
    monkeypatch.setattr(pipeline.stt_mod, 'transcribe_words', lambda _: ([{'start': 0, 'end': 2, 'text': 'wrong words'}], 'en', {}, 2))
    pipeline.run_phase_a(source.parent, tmp_path/'res', tmp_path/'work', '', tmp_path/'bundle')
    draft = review.read_bundle(tmp_path/'bundle'/'Album')
    assert draft['tracks'][0]['lrc'] == lrc
    assert draft['tracks'][0]['klrc'] == elrc
    assert draft['tracks'][0]['audio'] == 'song.wav'
    pipeline.run_phase_b(tmp_path/'bundle', tmp_path/'res')
    assert next((tmp_path/'res').rglob('*.lrc')).read_bytes() == lrc.encode()
    assert next((tmp_path/'res').rglob('*.elrc')).read_bytes() == elrc.encode()


def test_inst_only_upload_is_not_discarded_as_empty(tmp_path, monkeypatch, external):
    source = tmp_path/'payload'/'Inst'
    materialize(source, {'album':'Inst', 'tracks':[{'order':1, 'file':'music.wav', 'inst':True}]}, [{'path':'music.wav','role':'song'}])
    audio(source/'music.wav')
    monkeypatch.setattr(pipeline.stt_mod, 'transcribe_words', lambda _: pytest.fail('instrumental audio must not be transcribed'))
    result = pipeline.run_phase_a(source.parent, tmp_path/'res', tmp_path/'work', '', tmp_path/'bundle')
    assert result['result'] == 'ok'
    assert len(review.read_bundle(tmp_path/'bundle'/'Inst')['tracks']) == 1


def test_selected_cover_requires_an_uploaded_decodable_image(tmp_path, external):
    source = tmp_path/'payload'/'Album'
    materialize(source, {'album':'Album', 'tracks':[]}, [{'path':'cover.png','role':'cover'}])
    (source/'cover.png').write_bytes(b'not an image')
    with pytest.raises(ValueError, match='valid image'):
        pipeline.run_phase_a(source.parent, tmp_path/'res', tmp_path/'work', '', tmp_path/'bundle')


def test_pipeline_metadata_serializers_and_catalog_parser_preserve_valid_toml():
    import generate_meta
    import fetch_bilibili_meta
    metadata = {'vocal': ['Singer "A", B'], 'zh_name': 'Title "quoted"\r\nNext', 'lyric_maker': ['Editor']}
    for serialize in [generate_meta.serialize_meta, fetch_bilibili_meta.serialize_meta]:
        text = serialize(metadata)
        assert tomllib.loads(text)['演唱'] == metadata['vocal']
        assert parse_meta_text(text)['vocal'] == metadata['vocal']


def test_short_utf8_credits_are_not_guessed_as_another_encoding(tmp_path):
    path = tmp_path/'staff.txt'
    path.write_text('作词：StaffPerson\n', encoding='utf-8')
    assert pipeline.read_uploaded_text(path) == '作词：StaffPerson\n'


def test_photo_only_submission_runs_ocr_and_lyric_split(tmp_path, monkeypatch, external):
    source = tmp_path/'payload'/'Photo'
    materialize(source, {'album':'Photo', 'tracks':[]}, [{'path':'lyrics.png','role':'photo'}])
    Image.new('RGB', (2, 2), 'white').save(source/'lyrics.png')
    monkeypatch.setattr(pipeline.ocr_mod, 'run', lambda images: {'lyrics.png': 'hello world'})
    monkeypatch.setattr(organize, 'llm_split_booklet', lambda text, album: {'album': album, 'tracks':[{'order':1, 'title':'Photo Song', 'lyrics':'hello world'}]})
    result = pipeline.run_phase_a(source.parent, tmp_path/'res', tmp_path/'work', '', tmp_path/'bundle')
    assert result['result'] == 'ok'
    assert review.read_bundle(tmp_path/'bundle'/'Photo')['tracks'][0]['lines'] == ['hello world']


def test_elrc_only_upload_derives_lrc_and_keeps_word_times(tmp_path, external):
    source = tmp_path/'payload'/'Only'
    materialize(source, {'album':'Only', 'tracks':[]}, [])
    content = '[00:01.000]<00:01.200>hello\n'
    (source/'song.elrc').write_text(content)
    pipeline.run_phase_a(source.parent, tmp_path/'res', tmp_path/'work', '', tmp_path/'bundle')
    draft = review.read_bundle(tmp_path/'bundle'/'Only')
    assert draft['tracks'][0]['lrc'] == '[00:01.000]hello\n'
    assert draft['tracks'][0]['klrc'] == content
    pipeline.run_phase_b(tmp_path/'bundle', tmp_path/'res')
    assert next((tmp_path/'res').rglob('*.elrc')).read_text() == content


def test_existing_album_metadata_uses_the_catalog_parser_during_append(tmp_path, external):
    source = tmp_path/'payload'/'Existing'
    materialize(source, {'album':'Existing', 'tracks':[]}, [])
    (source/'song.lrc').write_text('[00:01.000]new lyric\n')
    existing = tmp_path/'res'/'Existing'
    existing.mkdir(parents=True)
    (existing/'meta.toml').write_text('中文名 = "Existing title"\n演唱 = ["Existing singer"]\n', encoding='utf-8')
    pipeline.run_phase_a(source.parent, tmp_path/'res', tmp_path/'work', '', tmp_path/'bundle')
    draft = review.read_bundle(tmp_path/'bundle'/'Existing')
    assert draft['meta']['vocal'] == ['Existing singer']
    assert draft['names']['zh_name'] == 'Existing title'
