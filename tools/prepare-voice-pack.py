#!/usr/bin/env python3
"""Prepare an approved VOLTMARCH ElevenLabs voice pack for game delivery.

The source exports stay outside the repository. This script detects their real
container, then produces trimmed, level-matched 48 kHz mono Ogg derivatives and
a hash-complete provenance file. Pack definitions keep transcripts, direction,
voice design and source history together so a later batch cannot silently drift.

Usage:
    py tools/prepare-voice-pack.py C:/Users/Administrator/Downloads --pack al-arm
    py tools/prepare-voice-pack.py C:/Users/Administrator/Downloads/Voltmarch --pack sv-arm
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf


OUTPUT_DIR = Path("apps/game/public/audio/voice")
OUTPUT_RATE = 48_000
TARGET_RMS_DB = -16.5
PEAK_CEILING_DB = -1.5
ACTIVE_THRESHOLD_DB = -38.0
LEAD_MS = 50
TAIL_MS = 120
MAX_DELIVERY_SECONDS = 2.0
TEMPO_TARGET_SECONDS = 1.95


@dataclass(frozen=True)
class Take:
    source: str
    output_id: str
    transcript: str
    direction: str


@dataclass(frozen=True)
class Pack:
    pack_id: str
    file_prefix: str
    display_name: str
    generated_date: str
    generation_settings: str
    source_note: str
    voice_design_prompt: str
    takes: tuple[Take, ...]
    provider_voice_id: str | None = None


PACKS = {
    "al-arm": Pack(
        pack_id="AL-ARM",
        file_prefix="al-arm",
        display_name="VM_AL_ARM_v1",
        generated_date="2026-08-25",
        generation_settings="API playground defaults; exact provider settings pending owner export",
        source_note=(
            "The API playground downloaded MP3 payloads as output.bin. The owner renamed them "
            "to the requested .wav take names; container detection, not the extension, is authoritative."
        ),
        voice_design_prompt=(
            "Native English, neutral international delivery. Female, 34–42. Studio quality. "
            "Persona: expeditionary armour crew chief. Emotion: focused, prepared, controlled. "
            "Clear lower-mid voice with crisp consonants and disciplined energy. Speaks quickly "
            "without rushing, like an experienced operator reading instruments and fire-control "
            "solutions. Confident through technical mastery, never swaggering, theatrical, "
            "synthetic or sarcastic."
        ),
        takes=(
            Take("al-arm.select.01.wav", "al-arm.select.0", "Armour crew online.", "calm and ready"),
            Take("al-arm.select.02.wav", "al-arm.select.1", "Armour ready.", "calm and ready"),
            Take("al-arm.select.03.wav", "al-arm.select.2", "Systems green.", "calm and ready"),
            Take("al-arm.move.01.wav", "al-arm.move.0", "Rolling on your mark.", "focused"),
            Take("al-arm.move.02.wav", "al-arm.move.1", "Route locked.", "focused"),
            Take("al-arm.move.03.wav", "al-arm.move.2", "Armour moving.", "focused"),
            Take("al-arm.attack.01.wav", "al-arm.attack.0", "Target solution confirmed.", "firm"),
            Take("al-arm.attack.02.wav", "al-arm.attack.1", "Engage the target.", "firm"),
            Take("al-arm.attack.03.wav", "al-arm.attack.2", "Precision fire.", "firm"),
            Take("al-arm.under-fire.01.wav", "al-arm.underFire.0", "Taking armour hits!", "urgent, controlled"),
            Take("al-arm.under-fire.02.wav", "al-arm.underFire.1", "Hull breach warning!", "urgent, controlled"),
            Take("al-arm.under-fire.03.wav", "al-arm.underFire.2", "We need a screen!", "urgent, controlled"),
        ),
    ),
    "sv-arm": Pack(
        pack_id="SV-ARM",
        file_prefix="sv-arm",
        display_name="VM_SV_ARM_v1",
        generated_date="2026-08-25",
        generation_settings="ElevenLabs API playground; output_format=wav_48000; model=eleven_v3",
        source_note=(
            "The owner exported each approved take directly as mono 48 kHz PCM WAV from the "
            "ElevenLabs API playground. Container detection remains authoritative."
        ),
        voice_design_prompt=(
            "Native English with restrained Eastern European colour. Male, 42–55. Studio quality. "
            "Persona: veteran heavy-armour crew chief. Emotion: resolute, grounded, controlled. "
            "Low, weighty voice with dense midrange and deliberate pacing. Nouns land firmly; "
            "urgency shortens pauses rather than becoming theatrical. Sounds physically familiar "
            "with engines and steel. Collective confidence, never cartoonish, drunken, fatalistic "
            "or comedic."
        ),
        takes=(
            Take("sv-arm.select.01.wav", "sv-arm.select.0", "Heavy armour ready.", "calm and weighty"),
            Take("sv-arm.select.02.wav", "sv-arm.select.1", "Steel standing by.", "calm and weighty"),
            Take("sv-arm.select.03.wav", "sv-arm.select.2", "Engines awake.", "calm and weighty"),
            Take("sv-arm.move.01.wav", "sv-arm.move.0", "Advance the line.", "deliberate"),
            Take("sv-arm.move.02.wav", "sv-arm.move.1", "Treads forward.", "deliberate"),
            Take("sv-arm.move.03.wav", "sv-arm.move.2", "We move.", "deliberate"),
            Take("sv-arm.attack.01.wav", "sv-arm.attack.0", "Load for battle.", "firm"),
            Take("sv-arm.attack.02.wav", "sv-arm.attack.1", "Break their line.", "firm"),
            Take("sv-arm.attack.03.wav", "sv-arm.attack.2", "Weapons, fire!", "firm"),
            Take("sv-arm.under-fire.01.wav", "sv-arm.underFire.0", "Armour holding!", "urgent, controlled"),
            Take("sv-arm.under-fire.02.wav", "sv-arm.underFire.1", "Taking heavy fire!", "urgent, controlled"),
            Take("sv-arm.under-fire.03.wav", "sv-arm.underFire.2", "Comrade, support the advance!", "urgent, controlled"),
        ),
    ),
    "mr-arm": Pack(
        pack_id="MR-ARM",
        file_prefix="mr-arm",
        display_name="VM_MR_ARM_v1",
        generated_date="2026-08-25",
        generation_settings="ElevenLabs API playground; output_format=wav_48000; model=eleven_v3",
        source_note=(
            "The owner exported each approved take directly as mono 48 kHz PCM WAV from the "
            "ElevenLabs API playground. Container detection remains authoritative."
        ),
        voice_design_prompt=(
            "Native English, any gender, 30–50. Studio quality. Persona: Meridian Pact armour "
            "navigator and fire-control operator. Measured, educated and luminous, with carefully "
            "formed vowels, soft starts and deliberate stress on operational nouns. Smooth "
            "135–155 WPM phrasing ending on firm consonants. Ceremonial precision without "
            "mysticism. Calm authority; damage breaks composure. Never whispery, robotic, "
            "priestly, fantasy-coded or pseudo-spiritual."
        ),
        takes=(
            Take("mr-arm.select.01.wav", "mr-arm.select.0", "Pact hull aligned.", "calm, measured, precise"),
            Take("mr-arm.select.02.wav", "mr-arm.select.1", "Hull in balance.", "calm, balanced, deliberate"),
            Take("mr-arm.select.03.wav", "mr-arm.select.2", "Weapon array ready.", "prepared, precise, controlled"),
            Take("mr-arm.move.01.wav", "mr-arm.move.0", "Course accepted.", "smooth, measured, assured"),
            Take("mr-arm.move.02.wav", "mr-arm.move.1", "Gliding to station.", "smooth, deliberate, composed"),
            Take("mr-arm.move.03.wav", "mr-arm.move.2", "We follow the light.", "smooth, composed, quietly assured"),
            Take("mr-arm.attack.01.wav", "mr-arm.attack.0", "Mark the distant target.", "focused, formal, commanding"),
            Take("mr-arm.attack.02.wav", "mr-arm.attack.1", "Weapon array committed.", "precise, firm, controlled"),
            Take("mr-arm.attack.03.wav", "mr-arm.attack.2", "Solution held.", "certain, restrained, decisive"),
            Take("mr-arm.under-fire.01.wav", "mr-arm.underFire.0", "Shield skin failing!", "urgent, composure breaking, controlled alarm"),
            Take("mr-arm.under-fire.02.wav", "mr-arm.underFire.1", "They have closed the distance!", "urgent, strained, composure breaking"),
            Take("mr-arm.under-fire.03.wav", "mr-arm.underFire.2", "Reform the line!", "urgent, commanding, recovering control"),
        ),
    ),
    "rc-arm": Pack(
        pack_id="RC-ARM",
        file_prefix="rc-arm",
        display_name="VM_RC_ARM_v1",
        generated_date="2026-08-25",
        generation_settings="ElevenLabs API playground; output_format=wav_48000; model=eleven_v3",
        source_note=(
            "The owner exported each approved take directly as mono 48 kHz PCM WAV from the "
            "ElevenLabs API playground. Container detection remains authoritative."
        ),
        voice_design_prompt=(
            "Native English, any gender, 35–55. Studio quality. Persona: veteran workshop crew "
            "chief operating improvised heavy armour. Textured, practical and direct, with natural "
            "regional colour and controlled upper-mid grit. Speaks at 145–170 WPM over imagined "
            "machinery: clipped setup, strong operative verbs and rough stops. Competent, "
            "physically engaged and dry without becoming comedic. Never pirate-like, stupid, "
            "manic or a scavenger caricature."
        ),
        takes=(
            Take("rc-arm.select.01.wav", "rc-arm.select.0", "Line rig fired up.", "ready, practical, textured"),
            Take("rc-arm.select.02.wav", "rc-arm.select.1", "Crew and weapon ready.", "confident, grounded, workmanlike"),
            Take("rc-arm.select.03.wav", "rc-arm.select.2", "Point us at the work.", "direct, eager, controlled grit"),
            Take("rc-arm.move.01.wav", "rc-arm.move.0", "Tracks turning.", "firm, practical, clipped"),
            Take("rc-arm.move.02.wav", "rc-arm.move.1", "Taking the short way.", "assured, slightly rough, purposeful"),
            Take("rc-arm.move.03.wav", "rc-arm.move.2", "Closing the gap.", "focused, purposeful, controlled grit"),
            Take("rc-arm.attack.01.wav", "rc-arm.attack.0", "Break them down.", "aggressive, practical, decisive"),
            Take("rc-arm.attack.02.wav", "rc-arm.attack.1", "Weapon live, face the target.", "commanding, rough, tightly controlled"),
            Take("rc-arm.attack.03.wav", "rc-arm.attack.2", "Strip it to frame.", "forceful, workmanlike, confident"),
            Take("rc-arm.under-fire.01.wav", "rc-arm.underFire.0", "Plate coming loose!", "urgent, strained, controlled alarm"),
            Take("rc-arm.under-fire.02.wav", "rc-arm.underFire.1", "We are taking it hard!", "urgent, physically strained, fighting for control"),
            Take("rc-arm.under-fire.03.wav", "rc-arm.underFire.2", "Welders, stand by!", "urgent, commanding, workshop discipline"),
        ),
    ),
    "al-inf-a": Pack(
        pack_id="AL-INF-A",
        file_prefix="al-inf-a",
        display_name="VM_AL_INF_A_v1",
        generated_date="2026-08-26",
        generation_settings="ElevenLabs API playground; output_format=wav_48000; model=eleven_v3",
        source_note=(
            "The owner exported each approved take directly as mono 48 kHz PCM WAV from the "
            "ElevenLabs API playground. Container detection remains authoritative."
        ),
        voice_design_prompt=(
            "Native English, male, 24–38. Studio quality. Persona: Allied expeditionary rifle-"
            "squad leader. Alert, mobile and mutually protective. Clear contemporary international "
            "English with crisp consonants, light contractions and a quick 155–175 WPM pace. "
            "Confidence comes from preparation, not swagger. Acknowledgements have a slight upward "
            "pickup and clean stop. Urgency sharpens his delivery without theatrical shouting. "
            "Never superheroic, sarcastic, aristocratic or action-movie macho."
        ),
        takes=(
            Take("al-inf-a.select.01.wav", "al-inf-a.select.0", "G.I. reporting.", "alert, professional, ready"),
            Take("al-inf-a.select.02.wav", "al-inf-a.select.1", "Awaiting orders.", "focused, attentive, disciplined"),
            Take("al-inf-a.select.03.wav", "al-inf-a.select.2", "Standing by.", "calm, prepared, concise"),
            Take("al-inf-a.select.04.wav", "al-inf-a.select.3", "Ready to move out.", "mobile, confident, controlled"),
            Take("al-inf-a.move.01.wav", "al-inf-a.move.0", "Moving out.", "quick, focused, affirmative"),
            Take("al-inf-a.move.02.wav", "al-inf-a.move.1", "On my way.", "quick, responsive, professional"),
            Take("al-inf-a.move.03.wav", "al-inf-a.move.2", "Affirmative.", "crisp, disciplined, affirmative"),
            Take("al-inf-a.move.04.wav", "al-inf-a.move.3", "Got it.", "concise, alert, confident"),
            Take("al-inf-a.attack.01.wav", "al-inf-a.attack.0", "Engaging.", "focused, urgent, controlled"),
            Take("al-inf-a.attack.02.wav", "al-inf-a.attack.1", "Opening fire.", "commanding, combat-ready, disciplined"),
            Take("al-inf-a.attack.03.wav", "al-inf-a.attack.2", "Target acquired.", "precise, alert, decisive"),
            Take("al-inf-a.attack.04.wav", "al-inf-a.attack.3", "Weapons free.", "firm, aggressive, controlled"),
            Take("al-inf-a.under-fire.01.wav", "al-inf-a.underFire.0", "Taking fire!", "urgent, sharp, controlled alarm"),
            Take("al-inf-a.under-fire.02.wav", "al-inf-a.underFire.1", "We are pinned!", "strained, urgent, requesting support"),
            Take("al-inf-a.under-fire.03.wav", "al-inf-a.underFire.2", "Squad under fire!", "urgent, protective, disciplined"),
            Take("al-inf-a.deploy.01.wav", "al-inf-a.deploy.0", "Digging in.", "focused, practical, preparing position"),
            Take("al-inf-a.deploy.02.wav", "al-inf-a.deploy.1", "Sandbags up.", "commanding, workmanlike, concise"),
        ),
    ),
    "al-inf-b": Pack(
        pack_id="AL-INF-B",
        file_prefix="al-inf-b",
        display_name="VM_AL_INF_B_v1",
        generated_date="2026-08-26",
        generation_settings="ElevenLabs API; output_format=wav_48000; model=eleven_v3",
        source_note=(
            "Generated through the project automation with the owner's restricted ElevenLabs API "
            "credential and exported directly as mono 48 kHz PCM WAV."
        ),
        voice_design_prompt=(
            "Native English, female, 26–40. Studio quality. Persona: Allied expeditionary fire-team "
            "leader. Alert, observant and mutually protective. Clear contemporary international "
            "English with crisp consonants, natural contractions and a quick 155–175 WPM pace. "
            "Confident through training and awareness rather than swagger. Responses begin promptly "
            "and stop cleanly. Combat urgency remains intelligible and disciplined. Never superheroic, "
            "sarcastic, aristocratic, flirtatious or action-movie macho."
        ),
        takes=(
            Take("al-inf-b.select.01.wav", "al-inf-b.select.0", "Squad two reporting.", "alert, professional, ready"),
            Take("al-inf-b.select.02.wav", "al-inf-b.select.1", "Ready when you are.", "focused, responsive, disciplined"),
            Take("al-inf-b.select.03.wav", "al-inf-b.select.2", "Eyes up, standing by.", "observant, prepared, concise"),
            Take("al-inf-b.select.04.wav", "al-inf-b.select.3", "Team ready to move.", "mobile, confident, controlled"),
            Take("al-inf-b.move.01.wav", "al-inf-b.move.0", "Moving now.", "quick, focused, affirmative"),
            Take("al-inf-b.move.02.wav", "al-inf-b.move.1", "On the route.", "quick, responsive, professional"),
            Take("al-inf-b.move.03.wav", "al-inf-b.move.2", "Understood.", "crisp, disciplined, affirmative"),
            Take("al-inf-b.move.04.wav", "al-inf-b.move.3", "We're on it.", "concise, alert, confident"),
            Take("al-inf-b.attack.01.wav", "al-inf-b.attack.0", "Contact, engaging.", "focused, urgent, controlled"),
            Take("al-inf-b.attack.02.wav", "al-inf-b.attack.1", "Firing on target.", "commanding, combat-ready, disciplined"),
            Take("al-inf-b.attack.03.wav", "al-inf-b.attack.2", "Target marked.", "precise, alert, decisive"),
            Take("al-inf-b.attack.04.wav", "al-inf-b.attack.3", "Weapons clear.", "firm, aggressive, controlled"),
            Take("al-inf-b.under-fire.01.wav", "al-inf-b.underFire.0", "Incoming fire!", "urgent, sharp, controlled alarm"),
            Take("al-inf-b.under-fire.02.wav", "al-inf-b.underFire.1", "We're taking hits!", "strained, urgent, requesting support"),
            Take("al-inf-b.under-fire.03.wav", "al-inf-b.underFire.2", "Need cover here!", "urgent, protective, disciplined"),
            Take("al-inf-b.deploy.01.wav", "al-inf-b.deploy.0", "Setting the position.", "focused, practical, preparing position"),
            Take("al-inf-b.deploy.02.wav", "al-inf-b.deploy.1", "Cover going up.", "commanding, workmanlike, concise"),
        ),
        provider_voice_id="6qKd4RiE7PATbsfYOePV",
    ),
    "sv-inf-a": Pack(
        pack_id="SV-INF-A",
        file_prefix="sv-inf-a",
        display_name="VM_SV_INF_A_v1",
        generated_date="2026-08-26",
        generation_settings="ElevenLabs API; output_format=wav_48000; model=eleven_v3",
        source_note=(
            "Generated through the project automation with the owner's restricted ElevenLabs API "
            "credential and exported directly as mono 48 kHz PCM WAV. Candidate 2 from the "
            "recorded SV-INF-A audition was selected by the owner."
        ),
        voice_design_prompt=(
            "Native English with restrained Eastern European colour. Male, 20-32. Studio quality. "
            "Persona: Soviet line-infantry squad leader. Alert, durable and collectively minded, "
            "with a firm industrial-military tone and dense lower midrange. Deliberate but combat-"
            "ready, 145-165 WPM. Orders land on strong nouns; urgency shortens pauses without "
            "theatrical shouting. Resolute rather than fatalistic. Never cartoonish, drunken, "
            "villainous, comedic or copied from another franchise."
        ),
        takes=(
            Take("sv-inf-a.select.01.wav", "sv-inf-a.select.0", "Conscript reporting.", "alert, disciplined, ready"),
            Take("sv-inf-a.select.02.wav", "sv-inf-a.select.1", "For the Union.", "resolute, collective pride, restrained"),
            Take("sv-inf-a.select.03.wav", "sv-inf-a.select.2", "Ready, Comrade.", "firm, responsive, grounded"),
            Take("sv-inf-a.select.04.wav", "sv-inf-a.select.3", "Awaiting command.", "attentive, deliberate, military"),
            Take("sv-inf-a.move.01.wav", "sv-inf-a.move.0", "Moving, Comrade.", "prompt, affirmative, controlled"),
            Take("sv-inf-a.move.02.wav", "sv-inf-a.move.1", "As ordered.", "clipped, obedient, assured"),
            Take("sv-inf-a.move.03.wav", "sv-inf-a.move.2", "We advance.", "collective, purposeful, firm"),
            Take("sv-inf-a.move.04.wav", "sv-inf-a.move.3", "Forward together.", "resolute, mobile, disciplined"),
            Take("sv-inf-a.attack.01.wav", "sv-inf-a.attack.0", "Attacking!", "urgent, forceful, controlled"),
            Take("sv-inf-a.attack.02.wav", "sv-inf-a.attack.1", "Open fire!", "commanding, sharp, combat-ready"),
            Take("sv-inf-a.attack.03.wav", "sv-inf-a.attack.2", "Crush their position!", "aggressive, decisive, disciplined"),
            Take("sv-inf-a.attack.04.wav", "sv-inf-a.attack.3", "Break their line!", "forceful, collective, controlled"),
            Take("sv-inf-a.under-fire.01.wav", "sv-inf-a.underFire.0", "We are under fire!", "urgent, strained, controlled alarm"),
            Take("sv-inf-a.under-fire.02.wav", "sv-inf-a.underFire.1", "Comrade, we need support!", "urgent, requesting support, disciplined"),
            Take("sv-inf-a.under-fire.03.wav", "sv-inf-a.underFire.2", "Hold the line!", "urgent, commanding, resolute"),
            Take("sv-inf-a.deploy.01.wav", "sv-inf-a.deploy.0", "Taking position.", "focused, practical, preparing cover"),
            Take("sv-inf-a.deploy.02.wav", "sv-inf-a.deploy.1", "Fortify here.", "commanding, deliberate, concise"),
        ),
        provider_voice_id="VFTKJBzgh6dUGYe6uunP",
    ),
    "sv-inf-b": Pack(
        pack_id="SV-INF-B",
        file_prefix="sv-inf-b",
        display_name="VM_SV_INF_B_v1",
        generated_date="2026-08-26",
        generation_settings="ElevenLabs API; output_format=wav_48000; model=eleven_v3",
        source_note=(
            "Generated through the project automation with the owner's restricted ElevenLabs API "
            "credential and exported directly as mono 48 kHz PCM WAV. Candidate 2 from the "
            "recorded SV-INF-B audition was selected by the owner."
        ),
        voice_design_prompt=(
            "Native English with restrained Eastern European colour. Female, 28-42. Studio quality. "
            "Persona: Soviet line-infantry field sergeant. Grounded contralto with firm lower "
            "midrange, practical authority and collective resolve. Deliberate 130-150 WPM delivery; "
            "acknowledgements are economical and combat urgency tightens the rhythm without "
            "shrillness or melodrama. Experienced, protective and unsentimental. Never seductive, "
            "cartoonish, drunken, villainous, comedic or copied from another franchise."
        ),
        takes=(
            Take("sv-inf-b.select.01.wav", "sv-inf-b.select.0", "Rifle team standing by.", "grounded, attentive, ready"),
            Take("sv-inf-b.select.02.wav", "sv-inf-b.select.1", "The line is ready.", "firm, collective, restrained"),
            Take("sv-inf-b.select.03.wav", "sv-inf-b.select.2", "Orders, Comrade.", "practical, responsive, controlled"),
            Take("sv-inf-b.select.04.wav", "sv-inf-b.select.3", "We are prepared.", "resolute, assured, disciplined"),
            Take("sv-inf-b.move.01.wav", "sv-inf-b.move.0", "We move together.", "collective, purposeful, controlled"),
            Take("sv-inf-b.move.02.wav", "sv-inf-b.move.1", "Orders received.", "economical, affirmative, firm"),
            Take("sv-inf-b.move.03.wav", "sv-inf-b.move.2", "Taking the route.", "focused, mobile, deliberate"),
            Take("sv-inf-b.move.04.wav", "sv-inf-b.move.3", "Forward, keep pace.", "commanding, protective, urgent restraint"),
            Take("sv-inf-b.attack.01.wav", "sv-inf-b.attack.0", "Bring fire on that position!", "commanding, forceful, controlled"),
            Take("sv-inf-b.attack.02.wav", "sv-inf-b.attack.1", "Target the front!", "sharp, tactical, combat-ready"),
            Take("sv-inf-b.attack.03.wav", "sv-inf-b.attack.2", "Weapons forward!", "urgent, collective, disciplined"),
            Take("sv-inf-b.attack.04.wav", "sv-inf-b.attack.3", "Drive them back!", "aggressive, decisive, controlled"),
            Take("sv-inf-b.under-fire.01.wav", "sv-inf-b.underFire.0", "The line is taking hits!", "urgent, strained, protective"),
            Take("sv-inf-b.under-fire.02.wav", "sv-inf-b.underFire.1", "Support us now, Comrade!", "urgent, requesting support, controlled alarm"),
            Take("sv-inf-b.under-fire.03.wav", "sv-inf-b.underFire.2", "Keep formation!", "commanding under pressure, resolute"),
            Take("sv-inf-b.deploy.01.wav", "sv-inf-b.deploy.0", "Securing this ground.", "focused, practical, deliberate"),
            Take("sv-inf-b.deploy.02.wav", "sv-inf-b.deploy.1", "Position reinforced.", "firm, workmanlike, concise"),
        ),
        provider_voice_id="zDP7e1ilmX5jo5E5hfKf",
    ),
    "mr-inf-a": Pack(
        pack_id="MR-INF-A",
        file_prefix="mr-inf-a",
        display_name="VM_MR_INF_A_v1",
        generated_date="2026-08-26",
        generation_settings="ElevenLabs API; output_format=wav_48000; model=eleven_v3",
        source_note=(
            "Generated through the project automation with the owner's restricted ElevenLabs API "
            "credential and exported directly as mono 48 kHz PCM WAV. Candidate 2 from the "
            "recorded MR-INF-A audition was selected by the owner."
        ),
        voice_design_prompt=(
            "Native English, male, 28-42. Studio quality. Persona: Meridian Pact line-infantry "
            "survey leader. Measured, educated and luminous rather than mystical, with carefully "
            "formed vowels, soft starts and firm final consonants. Smooth 135-155 WPM delivery; "
            "observant, restrained and attentive to distance and formation. Calm authority holds "
            "until damage briefly fractures it. Never whispery, robotic, priestly, fantasy-coded, "
            "pompous or copied from another franchise."
        ),
        takes=(
            Take("mr-inf-a.select.01.wav", "mr-inf-a.select.0", "Pact cadre ready.", "measured, attentive, prepared"),
            Take("mr-inf-a.select.02.wav", "mr-inf-a.select.1", "Wayfarer aligned.", "precise, calm, observant"),
            Take("mr-inf-a.select.03.wav", "mr-inf-a.select.2", "Formation observed.", "analytical, restrained, assured"),
            Take("mr-inf-a.select.04.wav", "mr-inf-a.select.3", "Awaiting the measure.", "patient, educated, deliberate"),
            Take("mr-inf-a.move.01.wav", "mr-inf-a.move.0", "Proceeding.", "smooth, concise, affirmative"),
            Take("mr-inf-a.move.02.wav", "mr-inf-a.move.1", "Course is clear.", "observant, composed, precise"),
            Take("mr-inf-a.move.03.wav", "mr-inf-a.move.2", "Advancing by interval.", "measured, tactical, controlled"),
            Take("mr-inf-a.move.04.wav", "mr-inf-a.move.3", "We take the marked path.", "calm, purposeful, disciplined"),
            Take("mr-inf-a.attack.01.wav", "mr-inf-a.attack.0", "Mark the target.", "focused, formal, commanding"),
            Take("mr-inf-a.attack.02.wav", "mr-inf-a.attack.1", "Solution confirmed.", "precise, firm, decisive"),
            Take("mr-inf-a.attack.03.wav", "mr-inf-a.attack.2", "Commit fire.", "restrained force, combat-ready"),
            Take("mr-inf-a.attack.04.wav", "mr-inf-a.attack.3", "Break their alignment.", "commanding, tactical, controlled"),
            Take("mr-inf-a.under-fire.01.wav", "mr-inf-a.underFire.0", "We are engaged!", "urgent, composure beginning to fracture"),
            Take("mr-inf-a.under-fire.02.wav", "mr-inf-a.underFire.1", "Our line is compromised!", "strained, urgent, precise alarm"),
            Take("mr-inf-a.under-fire.03.wav", "mr-inf-a.underFire.2", "Reform on me!", "commanding under pressure, recovering control"),
            Take("mr-inf-a.deploy.01.wav", "mr-inf-a.deploy.0", "Establishing the line.", "focused, measured, practical"),
            Take("mr-inf-a.deploy.02.wav", "mr-inf-a.deploy.1", "This ground is measured.", "calm, certain, concise"),
        ),
        provider_voice_id="yWvDkGL8UmGpft8ondgx",
    ),
    "mr-inf-b": Pack(
        pack_id="MR-INF-B",
        file_prefix="mr-inf-b",
        display_name="VM_MR_INF_B_v1",
        generated_date="2026-08-26",
        generation_settings="ElevenLabs API; output_format=wav_48000; model=eleven_v3",
        source_note=(
            "Generated through the project automation with the owner's restricted ElevenLabs API "
            "credential and exported directly as mono 48 kHz PCM WAV. Candidate 3 from the "
            "recorded MR-INF-B audition was selected by the owner."
        ),
        voice_design_prompt=(
            "Native English, female, 30-46. Studio quality. Persona: Meridian Pact line-infantry "
            "geometry officer. Clear alto with carefully formed vowels, soft starts and firm final "
            "consonants. Smooth 135-155 WPM delivery; observant, restrained and precise about "
            "distance, intervals and formation. Confidence is calm and educated; incoming fire "
            "fractures composure briefly without screaming. Never mystical, whispery, robotic, "
            "priestly, fantasy-coded, flirtatious or copied from another franchise."
        ),
        takes=(
            Take("mr-inf-b.select.01.wav", "mr-inf-b.select.0", "Second cadre attentive.", "clear, attentive, measured"),
            Take("mr-inf-b.select.02.wav", "mr-inf-b.select.1", "Interval confirmed.", "precise, calm, assured"),
            Take("mr-inf-b.select.03.wav", "mr-inf-b.select.2", "Sunlancer in order.", "formal, prepared, restrained"),
            Take("mr-inf-b.select.04.wav", "mr-inf-b.select.3", "Reading the field.", "observant, educated, focused"),
            Take("mr-inf-b.move.01.wav", "mr-inf-b.move.0", "Advancing on measure.", "smooth, purposeful, precise"),
            Take("mr-inf-b.move.02.wav", "mr-inf-b.move.1", "Course accepted.", "concise, affirmative, composed"),
            Take("mr-inf-b.move.03.wav", "mr-inf-b.move.2", "Maintaining interval.", "measured, tactical, controlled"),
            Take("mr-inf-b.move.04.wav", "mr-inf-b.move.3", "Following the clear line.", "calm, mobile, observant"),
            Take("mr-inf-b.attack.01.wav", "mr-inf-b.attack.0", "Focus fire on the marked point!", "commanding, precise, controlled"),
            Take("mr-inf-b.attack.02.wav", "mr-inf-b.attack.1", "Range fixed.", "firm, analytical, decisive"),
            Take("mr-inf-b.attack.03.wav", "mr-inf-b.attack.2", "Commit the array!", "forceful, formal, combat-ready"),
            Take("mr-inf-b.attack.04.wav", "mr-inf-b.attack.3", "Correct their position!", "urgent, tactical, restrained"),
            Take("mr-inf-b.under-fire.01.wav", "mr-inf-b.underFire.0", "We are taking pressure!", "urgent, composure fracturing"),
            Take("mr-inf-b.under-fire.02.wav", "mr-inf-b.underFire.1", "Formation is breaking!", "strained, precise alarm"),
            Take("mr-inf-b.under-fire.03.wav", "mr-inf-b.underFire.2", "Close the formation!", "commanding under fire, recovering control"),
            Take("mr-inf-b.deploy.01.wav", "mr-inf-b.deploy.0", "Setting the interval.", "focused, measured, practical"),
            Take("mr-inf-b.deploy.02.wav", "mr-inf-b.deploy.1", "Ground pattern secured.", "calm, certain, concise"),
        ),
        provider_voice_id="s8mQWcf6swSNCDquVX7r",
    ),
    "rc-inf-a": Pack(
        pack_id="RC-INF-A",
        file_prefix="rc-inf-a",
        display_name="VM_RC_INF_A_v1",
        generated_date="2026-08-26",
        generation_settings="ElevenLabs API; output_format=wav_48000; model=eleven_v3",
        source_note=(
            "Generated through the project automation with the owner's restricted ElevenLabs API "
            "credential and exported directly as mono 48 kHz PCM WAV. Candidate 3 from the "
            "recorded RC-INF-A audition was selected by the owner."
        ),
        voice_design_prompt=(
            "Native English, male, 30-46. Studio quality. Persona: Reclamation League line-"
            "infantry breaker-crew foreman. Textured, practical voice with natural regional colour "
            "and controlled upper-mid grit. Quick 145-170 WPM delivery over imagined machinery: "
            "clipped setup, strong operative verbs and rough stops. Close-range, physically engaged "
            "and impatient to work, with dry confidence but no comedy. Never pirate-like, stupid, "
            "manic, caricatured or copied from another franchise."
        ),
        takes=(
            Take("rc-inf-a.select.01.wav", "rc-inf-a.select.0", "Breaker ready.", "textured, ready, practical"),
            Take("rc-inf-a.select.02.wav", "rc-inf-a.select.1", "Crew checked in.", "workmanlike, alert, grounded"),
            Take("rc-inf-a.select.03.wav", "rc-inf-a.select.2", "Hands ready.", "clipped, confident, physically engaged"),
            Take("rc-inf-a.select.04.wav", "rc-inf-a.select.3", "Point us at the work.", "direct, eager, controlled grit"),
            Take("rc-inf-a.move.01.wav", "rc-inf-a.move.0", "On the haul.", "quick, practical, affirmative"),
            Take("rc-inf-a.move.02.wav", "rc-inf-a.move.1", "Taking the short way.", "assured, purposeful, dry"),
            Take("rc-inf-a.move.03.wav", "rc-inf-a.move.2", "Boots moving.", "clipped, mobile, rough stop"),
            Take("rc-inf-a.move.04.wav", "rc-inf-a.move.3", "Close the gap.", "urgent, purposeful, controlled"),
            Take("rc-inf-a.attack.01.wav", "rc-inf-a.attack.0", "Take it apart.", "aggressive, practical, decisive"),
            Take("rc-inf-a.attack.02.wav", "rc-inf-a.attack.1", "Strip that position to frame!", "forceful, workmanlike, commanding"),
            Take("rc-inf-a.attack.03.wav", "rc-inf-a.attack.2", "Tools up, hit them!", "urgent, physical, controlled grit"),
            Take("rc-inf-a.attack.04.wav", "rc-inf-a.attack.3", "Break it down!", "short, forceful, decisive"),
            Take("rc-inf-a.under-fire.01.wav", "rc-inf-a.underFire.0", "Taking hits!", "urgent, strained, controlled alarm"),
            Take("rc-inf-a.under-fire.02.wav", "rc-inf-a.underFire.1", "Plate is coming apart!", "urgent, physical strain, practical alarm"),
            Take("rc-inf-a.under-fire.03.wav", "rc-inf-a.underFire.2", "Need welders forward!", "commanding under pressure, requesting support"),
            Take("rc-inf-a.deploy.01.wav", "rc-inf-a.deploy.0", "Digging into the scrap.", "focused, practical, energetic"),
            Take("rc-inf-a.deploy.02.wav", "rc-inf-a.deploy.1", "Brace this ground.", "firm, workmanlike, concise"),
        ),
        provider_voice_id="imPLGIIqTf4lzcLLwDjt",
    ),
    "rc-inf-b": Pack(
        pack_id="RC-INF-B",
        file_prefix="rc-inf-b",
        display_name="VM_RC_INF_B_v1",
        generated_date="2026-08-26",
        generation_settings="ElevenLabs API; output_format=wav_48000; model=eleven_v3",
        source_note=(
            "Generated through the project automation with the owner's restricted ElevenLabs API "
            "credential and exported directly as mono 48 kHz PCM WAV. Candidate 1 from the "
            "recorded RC-INF-B audition was selected by the owner."
        ),
        voice_design_prompt=(
            "Native English, female, 28-44. Studio quality. Persona: Reclamation League line-"
            "infantry salvage crew lead. Textured, practical alto with natural regional colour, "
            "controlled grit and clear operative verbs. Quick 150-175 WPM delivery over imagined "
            "machinery; clipped setup, rough stops and hands-on confidence. Close-range, alert and "
            "impatient to finish the job, dry without comedy. Never pirate-like, stupid, manic, "
            "flirtatious, caricatured or copied from another franchise."
        ),
        takes=(
            Take("rc-inf-b.select.01.wav", "rc-inf-b.select.0", "Salvage crew listening.", "alert, textured, attentive"),
            Take("rc-inf-b.select.02.wav", "rc-inf-b.select.1", "Gear is checked.", "practical, confident, clipped"),
            Take("rc-inf-b.select.03.wav", "rc-inf-b.select.2", "Crew lead ready.", "grounded, direct, prepared"),
            Take("rc-inf-b.select.04.wav", "rc-inf-b.select.3", "What's the next cut?", "eager, hands-on, dry confidence"),
            Take("rc-inf-b.move.01.wav", "rc-inf-b.move.0", "Moving through the near cut.", "quick, purposeful, practical"),
            Take("rc-inf-b.move.02.wav", "rc-inf-b.move.1", "Taking the scrap road.", "assured, mobile, rough stop"),
            Take("rc-inf-b.move.03.wav", "rc-inf-b.move.2", "On our feet.", "clipped, affirmative, alert"),
            Take("rc-inf-b.move.04.wav", "rc-inf-b.move.3", "We'll get there.", "confident, concise, controlled grit"),
            Take("rc-inf-b.attack.01.wav", "rc-inf-b.attack.0", "Pull that position to pieces!", "forceful, practical, commanding"),
            Take("rc-inf-b.attack.02.wav", "rc-inf-b.attack.1", "Tear into it!", "aggressive, physical, decisive"),
            Take("rc-inf-b.attack.03.wav", "rc-inf-b.attack.2", "Put the tools through them!", "urgent, workmanlike, controlled grit"),
            Take("rc-inf-b.attack.04.wav", "rc-inf-b.attack.3", "Clear the lot!", "short, commanding, forceful"),
            Take("rc-inf-b.under-fire.01.wav", "rc-inf-b.underFire.0", "We are taking hard fire!", "urgent, strained, controlled alarm"),
            Take("rc-inf-b.under-fire.02.wav", "rc-inf-b.underFire.1", "Gear is buckling!", "urgent, practical alarm, physically strained"),
            Take("rc-inf-b.under-fire.03.wav", "rc-inf-b.underFire.2", "Brace and keep working!", "commanding under pressure, defiant"),
            Take("rc-inf-b.deploy.01.wav", "rc-inf-b.deploy.0", "Setting braces.", "focused, practical, quick"),
            Take("rc-inf-b.deploy.02.wav", "rc-inf-b.deploy.1", "Locking down the lot.", "firm, workmanlike, concise"),
        ),
        provider_voice_id="7VRfHXFqIttJDRoPZEcz",
    ),
    "al-harv": Pack(
        pack_id="AL-HARV",
        file_prefix="al-harv",
        display_name="VM_AL_HARV_v1",
        generated_date="2026-08-26",
        generation_settings="ElevenLabs API; output_format=wav_48000; model=eleven_v3",
        source_note=(
            "Generated through the project automation with the owner's restricted ElevenLabs API "
            "credential and exported directly as mono 48 kHz PCM WAV. Candidate 1 from the "
            "recorded AL-HARV audition was selected by the owner."
        ),
        voice_design_prompt=(
            "Native English, female, 32-48. Studio quality. Persona: Allied expeditionary ore-"
            "hauler operator: capable, alert, technically fluent and aware that the vehicle is a "
            "priority target. Clear contemporary international English, crisp consonants, steady "
            "lower-mid register and concise 150-165 WPM delivery. Routine logistics reports stay "
            "calm; damage becomes urgent without theatrical shouting. Never comic trucker, "
            "synthetic assistant, action hero, sarcastic, flirtatious or copied from an existing "
            "character."
        ),
        takes=(
            Take("al-harv.select.01.wav", "al-harv.select.0", "Allied ore crew ready.", "calm, capable, ready"),
            Take("al-harv.select.02.wav", "al-harv.select.1", "Collector systems green.", "technical, assured, concise"),
            Take("al-harv.select.03.wav", "al-harv.select.2", "Hauler standing by.", "alert, professional, prepared"),
            Take("al-harv.move.01.wav", "al-harv.move.0", "Rolling to the field.", "focused, affirmative, mobile"),
            Take("al-harv.move.02.wav", "al-harv.move.1", "Route to ore locked.", "technical, crisp, confident"),
            Take("al-harv.move.03.wav", "al-harv.move.2", "Hauler moving.", "concise, purposeful, controlled"),
            Take("al-harv.stop.01.wav", "al-harv.stop.0", "Parking the rig.", "calm, definite, practical"),
            Take("al-harv.stop.02.wav", "al-harv.stop.1", "Ore crew holding.", "steady, concise, attentive"),
            Take("al-harv.under-fire.01.wav", "al-harv.underFire.0", "Hauler taking fire!", "urgent, sharp, controlled alarm"),
            Take("al-harv.under-fire.02.wav", "al-harv.underFire.1", "Ore truck under attack!", "urgent, clear, requesting attention"),
            Take("al-harv.under-fire.03.wav", "al-harv.underFire.2", "We need an escort!", "urgent, disciplined request for support"),
            Take("al-harv.critical-damage.01.wav", "al-harv.criticalDamage.0", "Hopper rig critical!", "severe alarm, intelligible, controlled"),
            Take("al-harv.critical-damage.02.wav", "al-harv.criticalDamage.1", "We're losing the hauler!", "critical urgency, strained, no melodrama"),
            Take("al-harv.harvest.01.wav", "al-harv.harvest.0", "Starting extraction.", "calm technical report"),
            Take("al-harv.harvest.02.wav", "al-harv.harvest.1", "Ore intake active.", "precise, routine, assured"),
            Take("al-harv.harvest.03.wav", "al-harv.harvest.2", "Working this deposit.", "focused, workmanlike, calm"),
            Take("al-harv.cargo-full.01.wav", "al-harv.cargoFull.0", "Hopper full.", "clear factual capacity report"),
            Take("al-harv.cargo-full.02.wav", "al-harv.cargoFull.1", "Cargo at capacity.", "technical, exact, concise"),
            Take("al-harv.cargo-full.03.wav", "al-harv.cargoFull.2", "Full load secured.", "satisfied but disciplined"),
            Take("al-harv.return-to-refinery.01.wav", "al-harv.returnToRefinery.0", "Returning to refinery.", "calm route confirmation"),
            Take("al-harv.return-to-refinery.02.wav", "al-harv.returnToRefinery.1", "Hauling the load home.", "purposeful, steady, professional"),
            Take("al-harv.return-to-refinery.03.wav", "al-harv.returnToRefinery.2", "Route to the refinery.", "technical, concise, affirmative"),
        ),
        provider_voice_id="yHAhINsMnR6jFW9qAgMT",
    ),
    "sv-harv": Pack(
        pack_id="SV-HARV",
        file_prefix="sv-harv",
        display_name="VM_SV_HARV_v1",
        generated_date="2026-08-26",
        generation_settings="ElevenLabs API; output_format=wav_48000; model=eleven_v3",
        source_note=(
            "Generated through the project automation with the owner's restricted ElevenLabs API "
            "credential and exported directly as mono 48 kHz PCM WAV. Candidate 3 from the "
            "recorded SV-HARV audition was selected by the owner."
        ),
        voice_design_prompt=(
            "Native English, male, 40-58, with restrained natural Eastern European colour. "
            "Studio quality. Persona: veteran Soviet ore-hauler operator: overworked, dependable "
            "and physically familiar with heavy industrial machinery. Low, dense midrange; "
            "deliberate 130-150 WPM delivery with firm nouns. Routine reports are practical and "
            "collective; danger shortens pauses without theatrical shouting. Never cartoon "
            "villain, drunken, fatalistic, comic trucker or copied from an existing character."
        ),
        takes=(
            Take("sv-harv.select.01.wav", "sv-harv.select.0", "Ore crew standing by.", "low, dependable, attentive"),
            Take("sv-harv.select.02.wav", "sv-harv.select.1", "Hauler ready for work.", "practical, prepared, firm nouns"),
            Take("sv-harv.select.03.wav", "sv-harv.select.2", "Hopper is empty.", "dry factual report, ready"),
            Take("sv-harv.move.01.wav", "sv-harv.move.0", "Wheels to the field.", "purposeful, industrial, concise"),
            Take("sv-harv.move.02.wav", "sv-harv.move.1", "Taking the ore road.", "steady, practical route confirmation"),
            Take("sv-harv.move.03.wav", "sv-harv.move.2", "We haul.", "short, collective, firm"),
            Take("sv-harv.stop.01.wav", "sv-harv.stop.0", "Brakes set.", "clipped, definite, physical"),
            Take("sv-harv.stop.02.wav", "sv-harv.stop.1", "Holding the hauler.", "steady, attentive, concise"),
            Take("sv-harv.under-fire.01.wav", "sv-harv.underFire.0", "Ore truck under fire!", "urgent, controlled alarm, intelligible"),
            Take("sv-harv.under-fire.02.wav", "sv-harv.underFire.1", "They are hitting the hauler!", "urgent, shortened pauses, no theatrics"),
            Take("sv-harv.under-fire.03.wav", "sv-harv.underFire.2", "Escort, close on us!", "disciplined urgent command"),
            Take("sv-harv.critical-damage.01.wav", "sv-harv.criticalDamage.0", "Hauler is critical!", "severe controlled alarm"),
            Take("sv-harv.critical-damage.02.wav", "sv-harv.criticalDamage.1", "The rig will not hold!", "critical urgency, strained, clear"),
            Take("sv-harv.harvest.01.wav", "sv-harv.harvest.0", "Cutting into the seam.", "routine industrial report"),
            Take("sv-harv.harvest.02.wav", "sv-harv.harvest.1", "Ore intake running.", "practical, steady, assured"),
            Take("sv-harv.harvest.03.wav", "sv-harv.harvest.2", "Begin the load.", "firm, concise work order"),
            Take("sv-harv.cargo-full.01.wav", "sv-harv.cargoFull.0", "Hopper is full.", "clear factual capacity report"),
            Take("sv-harv.cargo-full.02.wav", "sv-harv.cargoFull.1", "Full Soviet load.", "collective pride, restrained"),
            Take("sv-harv.cargo-full.03.wav", "sv-harv.cargoFull.2", "Cargo secured.", "firm, satisfied, concise"),
            Take("sv-harv.return-to-refinery.01.wav", "sv-harv.returnToRefinery.0", "Returning with ore.", "steady route confirmation"),
            Take("sv-harv.return-to-refinery.02.wav", "sv-harv.returnToRefinery.1", "Take the load home.", "purposeful, collective, practical"),
            Take("sv-harv.return-to-refinery.03.wav", "sv-harv.returnToRefinery.2", "Refinery route set.", "concise technical confirmation"),
        ),
        provider_voice_id="sAFAxkq95QJiXqkBYrtI",
    ),
    "mr-harv": Pack(
        pack_id="MR-HARV",
        file_prefix="mr-harv",
        display_name="VM_MR_HARV_v1",
        generated_date="2026-08-26",
        generation_settings="ElevenLabs API; output_format=wav_48000; model=eleven_v3",
        source_note=(
            "Generated through the project automation with the owner's restricted ElevenLabs API "
            "credential and exported directly as mono 48 kHz PCM WAV. Candidate 3 from the "
            "recorded MR-HARV audition was selected by the owner."
        ),
        voice_design_prompt=(
            "Native English, female, 32-48. Studio quality. Persona: Meridian Sun Collector "
            "custodian, a composed field operator responsible for luminous energy and valuable "
            "material. Clear warm alto with measured 135-150 WPM delivery, precise consonants and "
            "quiet authority. Routine reports feel attentive and operational; danger becomes "
            "immediate without shouting. Human and grounded, never mystical, breathy, synthetic, "
            "seductive, ceremonial, or copied from an existing character."
        ),
        takes=(
            Take("mr-harv.select.01.wav", "mr-harv.select.0", "Sun Collector aligned.", "measured, attentive, quietly authoritative"),
            Take("mr-harv.select.02.wav", "mr-harv.select.1", "Reservoir ready.", "warm, precise readiness report"),
            Take("mr-harv.select.03.wav", "mr-harv.select.2", "Collection crew attentive.", "composed, operational, human"),
            Take("mr-harv.move.01.wav", "mr-harv.move.0", "Course to the seam.", "clear route confirmation"),
            Take("mr-harv.move.02.wav", "mr-harv.move.1", "Collector in motion.", "measured, purposeful movement report"),
            Take("mr-harv.move.03.wav", "mr-harv.move.2", "We follow the deposit.", "calm collective purpose"),
            Take("mr-harv.stop.01.wav", "mr-harv.stop.0", "Holding alignment.", "precise, steady, concise"),
            Take("mr-harv.stop.02.wav", "mr-harv.stop.1", "Collector at rest.", "calm operational report"),
            Take("mr-harv.under-fire.01.wav", "mr-harv.underFire.0", "Collector under fire!", "immediate controlled alarm"),
            Take("mr-harv.under-fire.02.wav", "mr-harv.underFire.1", "Our reservoir is exposed!", "urgent, protective concern, clear"),
            Take("mr-harv.under-fire.03.wav", "mr-harv.underFire.2", "We require a screen!", "disciplined urgent request"),
            Take("mr-harv.critical-damage.01.wav", "mr-harv.criticalDamage.0", "Collector integrity critical!", "severe technical alarm"),
            Take("mr-harv.critical-damage.02.wav", "mr-harv.criticalDamage.1", "The reservoir is failing!", "critical urgency without melodrama"),
            Take("mr-harv.harvest.01.wav", "mr-harv.harvest.0", "Drawing from the seam.", "measured routine extraction report"),
            Take("mr-harv.harvest.02.wav", "mr-harv.harvest.1", "Collection cycle active.", "precise, technical, assured"),
            Take("mr-harv.harvest.03.wav", "mr-harv.harvest.2", "The deposit yields.", "quiet satisfaction, grounded"),
            Take("mr-harv.cargo-full.01.wav", "mr-harv.cargoFull.0", "Reservoir at capacity.", "exact capacity report"),
            Take("mr-harv.cargo-full.02.wav", "mr-harv.cargoFull.1", "Full measure secured.", "restrained satisfaction"),
            Take("mr-harv.cargo-full.03.wav", "mr-harv.cargoFull.2", "Collection complete.", "clear completion report"),
            Take("mr-harv.return-to-refinery.01.wav", "mr-harv.returnToRefinery.0", "Returning to the receiver.", "calm route confirmation"),
            Take("mr-harv.return-to-refinery.02.wav", "mr-harv.returnToRefinery.1", "Carrying the measure home.", "warm, purposeful, composed"),
            Take("mr-harv.return-to-refinery.03.wav", "mr-harv.returnToRefinery.2", "Receiver course aligned.", "precise technical confirmation"),
        ),
        provider_voice_id="6jsz1H610zXl1SJ5pQQk",
    ),
    "rc-harv": Pack(
        pack_id="RC-HARV",
        file_prefix="rc-harv",
        display_name="VM_RC_HARV_v1",
        generated_date="2026-08-26",
        generation_settings="ElevenLabs API; output_format=wav_48000; model=eleven_v3",
        source_note=(
            "Generated through the project automation with the owner's restricted ElevenLabs API "
            "credential and exported directly as mono 48 kHz PCM WAV. Candidate 2 from the "
            "recorded RC-HARV audition was selected by the owner."
        ),
        voice_design_prompt=(
            "Native English, male, 34-52. Studio quality. Persona: Reclamation Scrapjaw operator, "
            "a capable salvage worker who knows every vibration of a heavy crusher rig. Textured "
            "medium-low voice, controlled grit, practical 140-155 WPM delivery and dry confidence. "
            "Reports are physical, concise and competent; danger adds pressure without losing "
            "clarity. Never pirate, feral scavenger, comic mechanic, drunken, monstrous, theatrical, "
            "or copied from an existing character."
        ),
        takes=(
            Take("rc-harv.select.01.wav", "rc-harv.select.0", "Scrapjaw crew ready.", "practical, prepared, controlled grit"),
            Take("rc-harv.select.02.wav", "rc-harv.select.1", "Crusher checked.", "dry technical confirmation"),
            Take("rc-harv.select.03.wav", "rc-harv.select.2", "Empty jaw, ready to work.", "physical, concise, competent"),
            Take("rc-harv.move.01.wav", "rc-harv.move.0", "Rolling to the cut.", "purposeful route confirmation"),
            Take("rc-harv.move.02.wav", "rc-harv.move.1", "Taking the salvage road.", "steady, workmanlike"),
            Take("rc-harv.move.03.wav", "rc-harv.move.2", "Jaw on the move.", "short, dry, assured"),
            Take("rc-harv.stop.01.wav", "rc-harv.stop.0", "Setting the brakes.", "physical, clipped, definite"),
            Take("rc-harv.stop.02.wav", "rc-harv.stop.1", "Holding the rig.", "steady, attentive"),
            Take("rc-harv.under-fire.01.wav", "rc-harv.underFire.0", "Scrapjaw taking hits!", "urgent controlled alarm"),
            Take("rc-harv.under-fire.02.wav", "rc-harv.underFire.1", "They're punching through the rig!", "pressured, clear, no theatrics"),
            Take("rc-harv.under-fire.03.wav", "rc-harv.underFire.2", "Need cover on the hauler!", "disciplined urgent request"),
            Take("rc-harv.critical-damage.01.wav", "rc-harv.criticalDamage.0", "Crusher frame critical!", "severe mechanical alarm"),
            Take("rc-harv.critical-damage.02.wav", "rc-harv.criticalDamage.1", "We're shedding the rig!", "critical urgency, strained, intelligible"),
            Take("rc-harv.harvest.01.wav", "rc-harv.harvest.0", "Biting into the seam.", "routine physical work report"),
            Take("rc-harv.harvest.02.wav", "rc-harv.harvest.1", "Crusher running.", "practical, steady, assured"),
            Take("rc-harv.harvest.03.wav", "rc-harv.harvest.2", "Pulling value out.", "dry satisfaction, grounded"),
            Take("rc-harv.cargo-full.01.wav", "rc-harv.cargoFull.0", "Jaw is full.", "clear factual capacity report"),
            Take("rc-harv.cargo-full.02.wav", "rc-harv.cargoFull.1", "Full load strapped.", "firm, workmanlike confirmation"),
            Take("rc-harv.cargo-full.03.wav", "rc-harv.cargoFull.2", "Hopper packed tight.", "dry, satisfied, concise"),
            Take("rc-harv.return-to-refinery.01.wav", "rc-harv.returnToRefinery.0", "Taking the load back.", "steady route confirmation"),
            Take("rc-harv.return-to-refinery.02.wav", "rc-harv.returnToRefinery.1", "Sorter route marked.", "precise, practical"),
            Take("rc-harv.return-to-refinery.03.wav", "rc-harv.returnToRefinery.2", "Hauling value home.", "purposeful, dry confidence"),
        ),
        provider_voice_id="NVO0qMwSsPnQVPu8mWvC",
    ),
    "al-build": Pack(
        pack_id="AL-BUILD",
        file_prefix="al-build",
        display_name="VM_AL_BUILD_v1",
        generated_date="2026-08-26",
        generation_settings="ElevenLabs API; output_format=wav_48000; model=eleven_v3",
        source_note=(
            "Generated through the project automation with the owner's restricted ElevenLabs API "
            "credential and exported directly as mono 48 kHz PCM WAV. Candidate 3 from the "
            "recorded AL-BUILD audition was selected by the owner."
        ),
        voice_design_prompt=(
            "Native English, male, 38-55. Studio quality. Persona: Allied expeditionary construction "
            "foreman commanding a mobile site crew under battlefield pressure. Clear grounded "
            "baritone, contemporary neutral accent, crisp technical diction and efficient 140-155 "
            "WPM delivery. Routine calls are calm, capable and safety-minded; danger is urgent but "
            "disciplined. Never comic contractor, military caricature, gravelly action hero, "
            "announcer, synthetic, theatrical, or copied from an existing character."
        ),
        takes=(
            Take("al-build.select.01.wav", "al-build.select.0", "Construction vehicle online.", "capable technical readiness report"),
            Take("al-build.select.02.wav", "al-build.select.1", "Site crew ready.", "grounded, attentive, concise"),
            Take("al-build.select.03.wav", "al-build.select.2", "Survey systems green.", "crisp technical confirmation"),
            Take("al-build.move.01.wav", "al-build.move.0", "Moving to the site.", "calm purposeful order confirmation"),
            Take("al-build.move.02.wav", "al-build.move.1", "Construction route locked.", "precise, efficient, assured"),
            Take("al-build.move.03.wav", "al-build.move.2", "Rolling on your mark.", "prepared, disciplined energy"),
            Take("al-build.stop.01.wav", "al-build.stop.0", "Site vehicle holding.", "steady operational report"),
            Take("al-build.stop.02.wav", "al-build.stop.1", "Parking the construction rig.", "practical, safety-minded"),
            Take("al-build.under-fire.01.wav", "al-build.underFire.0", "Construction vehicle taking fire!", "urgent controlled alarm"),
            Take("al-build.under-fire.02.wav", "al-build.underFire.1", "Site crew under attack!", "urgent concern, clear diction"),
            Take("al-build.under-fire.03.wav", "al-build.underFire.2", "We need protection!", "disciplined urgent request"),
            Take("al-build.critical-damage.01.wav", "al-build.criticalDamage.0", "Construction rig critical!", "severe technical alarm"),
            Take("al-build.critical-damage.02.wav", "al-build.criticalDamage.1", "We're losing the site vehicle!", "critical urgency without melodrama"),
            Take("al-build.deploy.01.wav", "al-build.deploy.0", "Establishing construction yard.", "authoritative deployment confirmation"),
            Take("al-build.deploy.02.wav", "al-build.deploy.1", "Deploying the site package.", "crisp technical action report"),
            Take("al-build.deploy.03.wav", "al-build.deploy.2", "Building the command site.", "capable, purposeful, concise"),
        ),
        provider_voice_id="dnuO7d08Bndwa142ia5A",
    ),
    "sv-build": Pack(
        pack_id="SV-BUILD",
        file_prefix="sv-build",
        display_name="VM_SV_BUILD_v1",
        generated_date="2026-08-26",
        generation_settings="ElevenLabs API; output_format=wav_48000; model=eleven_v3",
        source_note=(
            "Generated through the project automation with the owner's restricted ElevenLabs API "
            "credential and exported directly as mono 48 kHz PCM WAV. Candidate 2 from the "
            "recorded SV-BUILD audition was selected by the owner."
        ),
        voice_design_prompt=(
            "Native English, female, 40-58, with restrained Eastern European colour. Studio quality. "
            "Persona: veteran Soviet construction-column chief responsible for a massive mobile works "
            "rig and crew. Firm lower alto, deliberate 130-145 WPM delivery, hard consonants and "
            "unshowy authority. Routine orders are collective, practical and exact; danger becomes "
            "forceful without screaming. Never cartoon villain, propagandist, fatalistic, seductive, "
            "comic, synthetic, theatrical, or copied from an existing character."
        ),
        takes=(
            Take("sv-build.select.01.wav", "sv-build.select.0", "Construction column ready.", "firm collective readiness report"),
            Take("sv-build.select.02.wav", "sv-build.select.1", "Builder crew standing by.", "deliberate, attentive, practical"),
            Take("sv-build.select.03.wav", "sv-build.select.2", "Heavy rig prepared.", "unshowy authority, hard nouns"),
            Take("sv-build.move.01.wav", "sv-build.move.0", "Take us to the site.", "direct purposeful confirmation"),
            Take("sv-build.move.02.wav", "sv-build.move.1", "Builder rolling.", "concise industrial report"),
            Take("sv-build.move.03.wav", "sv-build.move.2", "Advance the construction rig.", "firm controlled order"),
            Take("sv-build.stop.01.wav", "sv-build.stop.0", "Brakes set.", "clipped physical confirmation"),
            Take("sv-build.stop.02.wav", "sv-build.stop.1", "Builder holding.", "steady, ready"),
            Take("sv-build.under-fire.01.wav", "sv-build.underFire.0", "Builder under fire!", "forceful controlled alarm"),
            Take("sv-build.under-fire.02.wav", "sv-build.underFire.1", "They are striking the construction rig!", "urgent, clear, no theatrics"),
            Take("sv-build.under-fire.03.wav", "sv-build.underFire.2", "Protect the crew!", "short urgent command"),
            Take("sv-build.critical-damage.01.wav", "sv-build.criticalDamage.0", "Construction rig critical!", "severe technical alarm"),
            Take("sv-build.critical-damage.02.wav", "sv-build.criticalDamage.1", "The builder will not hold!", "critical urgency, strained, clear"),
            Take("sv-build.deploy.01.wav", "sv-build.deploy.0", "Raise the construction yard.", "authoritative collective action"),
            Take("sv-build.deploy.02.wav", "sv-build.deploy.1", "Unfold the works.", "firm concise deployment command"),
            Take("sv-build.deploy.03.wav", "sv-build.deploy.2", "Establish the base.", "controlled decisive completion"),
        ),
        provider_voice_id="53q90DJPCeG6TeCgzaOr",
    ),
    "mr-build": Pack(
        pack_id="MR-BUILD",
        file_prefix="mr-build",
        display_name="VM_MR_BUILD_v1",
        generated_date="2026-08-26",
        generation_settings="ElevenLabs API; output_format=wav_48000; model=eleven_v3",
        source_note=(
            "Generated through the project automation with the owner's restricted ElevenLabs API "
            "credential and exported directly as mono 48 kHz PCM WAV. Candidate 2 from the "
            "recorded MR-BUILD audition was selected by the owner."
        ),
        voice_design_prompt=(
            "Native English, male, 34-50. Studio quality. Persona: Meridian Pactworks foundation "
            "master guiding a mobile Carryall with calm architectural precision. Clear resonant "
            "tenor-baritone, measured 135-150 WPM delivery, exact consonants and humane authority. "
            "Routine reports are balanced, attentive and operational; danger tightens the pace "
            "without shouting. Never mystic, priestly, breathy, synthetic, aristocratic, ceremonial, "
            "theatrical, or copied from an existing character."
        ),
        takes=(
            Take("mr-build.select.01.wav", "mr-build.select.0", "Pactworks Carryall aligned.", "measured architectural readiness report"),
            Take("mr-build.select.02.wav", "mr-build.select.1", "Foundation crew attentive.", "humane authority, composed"),
            Take("mr-build.select.03.wav", "mr-build.select.2", "Site instruments ready.", "precise technical confirmation"),
            Take("mr-build.move.01.wav", "mr-build.move.0", "Course to the foundation.", "calm exact route confirmation"),
            Take("mr-build.move.02.wav", "mr-build.move.1", "Carryall in motion.", "balanced purposeful report"),
            Take("mr-build.move.03.wav", "mr-build.move.2", "We approach the site.", "attentive collective purpose"),
            Take("mr-build.stop.01.wav", "mr-build.stop.0", "Holding site alignment.", "precise, steady, concise"),
            Take("mr-build.stop.02.wav", "mr-build.stop.1", "Carryall at rest.", "calm operational report"),
            Take("mr-build.under-fire.01.wav", "mr-build.underFire.0", "Carryall under fire!", "immediate controlled alarm"),
            Take("mr-build.under-fire.02.wav", "mr-build.underFire.1", "The foundation package is exposed!", "urgent protective concern, clear"),
            Take("mr-build.under-fire.03.wav", "mr-build.underFire.2", "We require protection!", "disciplined urgent request"),
            Take("mr-build.critical-damage.01.wav", "mr-build.criticalDamage.0", "Carryall integrity critical!", "severe technical alarm"),
            Take("mr-build.critical-damage.02.wav", "mr-build.criticalDamage.1", "The site package is failing!", "critical urgency without melodrama"),
            Take("mr-build.deploy.01.wav", "mr-build.deploy.0", "Establishing the Conclave.", "calm authoritative deployment"),
            Take("mr-build.deploy.02.wav", "mr-build.deploy.1", "Unfold the foundation.", "precise technical action"),
            Take("mr-build.deploy.03.wav", "mr-build.deploy.2", "The new site begins.", "grounded completion, quiet purpose"),
        ),
        provider_voice_id="Jjp20r75U0Vw3LUT6Qar",
    ),
    "rc-build": Pack(
        pack_id="RC-BUILD",
        file_prefix="rc-build",
        display_name="VM_RC_BUILD_v1",
        generated_date="2026-08-26",
        generation_settings="ElevenLabs API; output_format=wav_48000; model=eleven_v3",
        source_note=(
            "Generated through the project automation with the owner's restricted ElevenLabs API "
            "credential and exported directly as mono 48 kHz PCM WAV. Candidate 3 from the "
            "recorded RC-BUILD audition was selected by the owner."
        ),
        voice_design_prompt=(
            "Native English, female, 36-54. Studio quality. Persona: Reclamation Yardcrawler "
            "forewoman, a seasoned mobile-foundry operator who treats a huge improvised works rig "
            "like a trusted machine. Textured mid-low voice, controlled grit, dry confidence and "
            "practical 140-155 WPM delivery. Routine calls are physical and capable; danger adds "
            "pressure without chaos. Never pirate, feral scavenger, comic mechanic, seductive, "
            "monstrous, synthetic, theatrical, or copied from an existing character."
        ),
        takes=(
            Take("rc-build.select.01.wav", "rc-build.select.0", "Yardcrawler checked in.", "dry capable readiness report"),
            Take("rc-build.select.02.wav", "rc-build.select.1", "Foundry crew ready.", "seasoned, attentive, practical"),
            Take("rc-build.select.03.wav", "rc-build.select.2", "Mobile yard fired up.", "physical machine familiarity, assured"),
            Take("rc-build.move.01.wav", "rc-build.move.0", "Crawling to the lot.", "purposeful route confirmation"),
            Take("rc-build.move.02.wav", "rc-build.move.1", "Taking the yard road.", "steady, workmanlike"),
            Take("rc-build.move.03.wav", "rc-build.move.2", "Hauling the works over.", "controlled grit, concise"),
            Take("rc-build.stop.01.wav", "rc-build.stop.0", "Setting the crawler down.", "physical, careful, definite"),
            Take("rc-build.stop.02.wav", "rc-build.stop.1", "Yard rig holding.", "steady operational report"),
            Take("rc-build.under-fire.01.wav", "rc-build.underFire.0", "Yardcrawler taking hits!", "urgent controlled alarm"),
            Take("rc-build.under-fire.02.wav", "rc-build.underFire.1", "They're tearing into the works!", "pressured, clear, no chaos"),
            Take("rc-build.under-fire.03.wav", "rc-build.underFire.2", "Need cover on the crawler!", "disciplined urgent request"),
            Take("rc-build.critical-damage.01.wav", "rc-build.criticalDamage.0", "Yard frame critical!", "severe mechanical alarm"),
            Take("rc-build.critical-damage.02.wav", "rc-build.criticalDamage.1", "We're losing the crawler!", "critical urgency, strained, intelligible"),
            Take("rc-build.deploy.01.wav", "rc-build.deploy.0", "Setting up the Foundry.", "capable deployment confirmation"),
            Take("rc-build.deploy.02.wav", "rc-build.deploy.1", "Drop the braces and build.", "firm practical action command"),
            Take("rc-build.deploy.03.wav", "rc-build.deploy.2", "Turning this lot into a yard.", "dry confidence, purposeful finish"),
        ),
        provider_voice_id="WokHgdKMqKKBKkaQrTAN",
    ),
    "al-spec": Pack(
        pack_id="AL-SPEC", file_prefix="al-spec", display_name="VM_AL_SPEC_v1",
        generated_date="2026-08-26",
        generation_settings="ElevenLabs API; output_format=wav_48000; model=eleven_v3",
        source_note="Generated through project automation. Candidate 1 selected by the owner.",
        voice_design_prompt=(
            "Native English, female, 30-46. Studio quality. Allied expeditionary systems engineer: "
            "clear lower-mid voice, crisp contemporary diction, efficient 150-165 WPM delivery, "
            "exact and procedure-led, urgent without action-hero bravado."
        ),
        takes=(
            Take("al-spec.select.01.wav", "al-spec.select.0", "Engineer on station.", "alert technical readiness"),
            Take("al-spec.select.02.wav", "al-spec.select.1", "Field kit ready.", "crisp concise confirmation"),
            Take("al-spec.select.03.wav", "al-spec.select.2", "Systems specialist here.", "capable, attentive"),
            Take("al-spec.select.04.wav", "al-spec.select.3", "Site diagnostics online.", "precise technical report"),
            Take("al-spec.move.01.wav", "al-spec.move.0", "Moving to inspect.", "purposeful order confirmation"),
            Take("al-spec.move.02.wav", "al-spec.move.1", "Route to site confirmed.", "exact and efficient"),
            Take("al-spec.move.03.wav", "al-spec.move.2", "Engineer en route.", "quick professional confirmation"),
            Take("al-spec.stop.01.wav", "al-spec.stop.0", "Holding for instructions.", "calm ready state"),
            Take("al-spec.stop.02.wav", "al-spec.stop.1", "Field kit standing by.", "attentive and concise"),
            Take("al-spec.under-fire.01.wav", "al-spec.underFire.0", "Engineer taking fire!", "urgent controlled alarm"),
            Take("al-spec.under-fire.02.wav", "al-spec.underFire.1", "Site team under attack!", "urgent, clear diction"),
            Take("al-spec.under-fire.03.wav", "al-spec.underFire.2", "I need security here!", "disciplined request for cover"),
            Take("al-spec.critical-damage.01.wav", "al-spec.criticalDamage.0", "Field suit critical!", "severe technical alarm"),
            Take("al-spec.critical-damage.02.wav", "al-spec.criticalDamage.1", "Engineer is going down!", "critical urgency without melodrama"),
            Take("al-spec.capture.01.wav", "al-spec.capture.0", "Securing the structure.", "exact capture intent"),
            Take("al-spec.capture.02.wav", "al-spec.capture.1", "Taking control of the site.", "confident technical action"),
            Take("al-spec.capture.03.wav", "al-spec.capture.2", "Beginning systems takeover.", "procedure-led, focused"),
            Take("al-spec.repair.01.wav", "al-spec.repair.0", "Starting field repairs.", "calm repair intent"),
            Take("al-spec.repair.02.wav", "al-spec.repair.1", "Restoring the system.", "precise and capable"),
            Take("al-spec.repair.03.wav", "al-spec.repair.2", "Repair protocol active.", "crisp technical confirmation"),
        ), provider_voice_id="bH9xAZrOURm8vX0Cin4q",
    ),
    "sv-spec": Pack(
        pack_id="SV-SPEC", file_prefix="sv-spec", display_name="VM_SV_SPEC_v1",
        generated_date="2026-08-26",
        generation_settings="ElevenLabs API; output_format=wav_48000; model=eleven_v3",
        source_note="Generated through project automation. Candidate 3 selected by the owner.",
        voice_design_prompt=(
            "Native English, male, 42-60, restrained Eastern European colour. Veteran Soviet field "
            "engineer: dense mid-low voice, deliberate 130-145 WPM delivery, economical collective "
            "phrasing and firm nouns, urgent without parody."
        ),
        takes=(
            Take("sv-spec.select.01.wav", "sv-spec.select.0", "Field engineer ready.", "firm practical readiness"),
            Take("sv-spec.select.02.wav", "sv-spec.select.1", "Tools prepared.", "economical technical confirmation"),
            Take("sv-spec.select.03.wav", "sv-spec.select.2", "Technical crew standing by.", "collective, attentive"),
            Take("sv-spec.select.04.wav", "sv-spec.select.3", "The work can begin.", "restrained confidence"),
            Take("sv-spec.move.01.wav", "sv-spec.move.0", "Take me to the site.", "direct purposeful confirmation"),
            Take("sv-spec.move.02.wav", "sv-spec.move.1", "Engineer advancing.", "steady and concise"),
            Take("sv-spec.move.03.wav", "sv-spec.move.2", "Moving with the tools.", "physical, workmanlike"),
            Take("sv-spec.stop.01.wav", "sv-spec.stop.0", "Holding position.", "firm ready state"),
            Take("sv-spec.stop.02.wav", "sv-spec.stop.1", "Tools remain ready.", "calm and exact"),
            Take("sv-spec.under-fire.01.wav", "sv-spec.underFire.0", "Engineer under fire!", "urgent controlled alarm"),
            Take("sv-spec.under-fire.02.wav", "sv-spec.underFire.1", "They are hitting the technical crew!", "forceful, clear, no theatrics"),
            Take("sv-spec.under-fire.03.wav", "sv-spec.underFire.2", "Protect the specialist!", "short urgent command"),
            Take("sv-spec.critical-damage.01.wav", "sv-spec.criticalDamage.0", "Field equipment critical!", "severe mechanical alarm"),
            Take("sv-spec.critical-damage.02.wav", "sv-spec.criticalDamage.1", "I will not hold much longer!", "critical urgency, restrained"),
            Take("sv-spec.capture.01.wav", "sv-spec.capture.0", "Taking the structure for us.", "collective capture intent"),
            Take("sv-spec.capture.02.wav", "sv-spec.capture.1", "Their systems will answer to us.", "controlled certainty"),
            Take("sv-spec.capture.03.wav", "sv-spec.capture.2", "Beginning the takeover.", "firm technical action"),
            Take("sv-spec.repair.01.wav", "sv-spec.repair.0", "Restoring the machinery.", "practical repair intent"),
            Take("sv-spec.repair.02.wav", "sv-spec.repair.1", "Begin field repair.", "concise work order"),
            Take("sv-spec.repair.03.wav", "sv-spec.repair.2", "The system will run again.", "dependable restrained confidence"),
        ), provider_voice_id="w3tQTg1fMb132sKWlppW",
    ),
    "mr-spec": Pack(
        pack_id="MR-SPEC", file_prefix="mr-spec", display_name="VM_MR_SPEC_v1",
        generated_date="2026-08-26",
        generation_settings="ElevenLabs API; output_format=wav_48000; model=eleven_v3",
        source_note="Generated through project automation. Candidate 1 selected by the owner.",
        voice_design_prompt=(
            "Native English, female, 32-48. Meridian Artificer: clear warm alto, formed vowels, "
            "precise consonants and measured 135-150 WPM delivery; patient, operational and human, "
            "never mystical, breathy or synthetic."
        ),
        takes=(
            Take("mr-spec.select.01.wav", "mr-spec.select.0", "Artificer attentive.", "measured attentive readiness"),
            Take("mr-spec.select.02.wav", "mr-spec.select.1", "Instruments aligned.", "precise technical confirmation"),
            Take("mr-spec.select.03.wav", "mr-spec.select.2", "Restoration kit prepared.", "patient and operational"),
            Take("mr-spec.select.04.wav", "mr-spec.select.3", "The site can be measured.", "quiet capable authority"),
            Take("mr-spec.move.01.wav", "mr-spec.move.0", "Course to the work.", "calm route confirmation"),
            Take("mr-spec.move.02.wav", "mr-spec.move.1", "Approaching the site.", "measured purposeful movement"),
            Take("mr-spec.move.03.wav", "mr-spec.move.2", "Instruments in motion.", "precise concise report"),
            Take("mr-spec.stop.01.wav", "mr-spec.stop.0", "Holding the measure.", "steady attentive state"),
            Take("mr-spec.stop.02.wav", "mr-spec.stop.1", "Artificer at rest.", "calm operational report"),
            Take("mr-spec.under-fire.01.wav", "mr-spec.underFire.0", "Artificer under fire!", "composure breaking into controlled urgency"),
            Take("mr-spec.under-fire.02.wav", "mr-spec.underFire.1", "The instrument team is exposed!", "urgent protective concern"),
            Take("mr-spec.under-fire.03.wav", "mr-spec.underFire.2", "We require a screen!", "disciplined urgent request"),
            Take("mr-spec.critical-damage.01.wav", "mr-spec.criticalDamage.0", "Instrument integrity critical!", "severe technical alarm"),
            Take("mr-spec.critical-damage.02.wav", "mr-spec.criticalDamage.1", "My field rig is failing!", "critical urgency without melodrama"),
            Take("mr-spec.capture.01.wav", "mr-spec.capture.0", "Rewriting the site alignment.", "precise capture intent"),
            Take("mr-spec.capture.02.wav", "mr-spec.capture.1", "Bringing the structure into accord.", "patient technical action"),
            Take("mr-spec.capture.03.wav", "mr-spec.capture.2", "The new control pattern begins.", "quiet authoritative intent"),
            Take("mr-spec.repair.01.wav", "mr-spec.repair.0", "Restoring structural balance.", "measured repair intent"),
            Take("mr-spec.repair.02.wav", "mr-spec.repair.1", "Beginning the repair measure.", "precise operational report"),
            Take("mr-spec.repair.03.wav", "mr-spec.repair.2", "The system returns to alignment.", "calm completion intent"),
        ), provider_voice_id="uWCJB4cZr2qmoSriVFSP",
    ),
    "rc-spec": Pack(
        pack_id="RC-SPEC", file_prefix="rc-spec", display_name="VM_RC_SPEC_v1",
        generated_date="2026-08-26",
        generation_settings="ElevenLabs API; output_format=wav_48000; model=eleven_v3",
        source_note="Generated through project automation. Candidate 2 selected by the owner.",
        voice_design_prompt=(
            "Native English, male, 30-50. Reclamation Tinker: textured medium voice, controlled "
            "grit, dry confidence and clipped 145-165 WPM delivery; practical and direct, never "
            "pirate, feral scavenger or comic mechanic."
        ),
        takes=(
            Take("rc-spec.select.01.wav", "rc-spec.select.0", "Tinker checked in.", "dry capable readiness"),
            Take("rc-spec.select.02.wav", "rc-spec.select.1", "Tools are live.", "clipped technical confirmation"),
            Take("rc-spec.select.03.wav", "rc-spec.select.2", "Patch kit ready.", "practical and concise"),
            Take("rc-spec.select.04.wav", "rc-spec.select.3", "Show me what broke.", "dry confidence, attentive"),
            Take("rc-spec.move.01.wav", "rc-spec.move.0", "Heading to the job.", "purposeful route confirmation"),
            Take("rc-spec.move.02.wav", "rc-spec.move.1", "Taking the tool road.", "workmanlike and direct"),
            Take("rc-spec.move.03.wav", "rc-spec.move.2", "Tinker moving.", "short, controlled"),
            Take("rc-spec.stop.01.wav", "rc-spec.stop.0", "Setting the kit down.", "physical ready state"),
            Take("rc-spec.stop.02.wav", "rc-spec.stop.1", "Holding for the next job.", "calm dry confidence"),
            Take("rc-spec.under-fire.01.wav", "rc-spec.underFire.0", "Tinker taking hits!", "urgent controlled alarm"),
            Take("rc-spec.under-fire.02.wav", "rc-spec.underFire.1", "They're shooting up the tools!", "pressured, clear, no comedy"),
            Take("rc-spec.under-fire.03.wav", "rc-spec.underFire.2", "Need cover on this job!", "disciplined urgent request"),
            Take("rc-spec.critical-damage.01.wav", "rc-spec.criticalDamage.0", "Patch rig critical!", "severe mechanical alarm"),
            Take("rc-spec.critical-damage.02.wav", "rc-spec.criticalDamage.1", "I'm losing the whole kit!", "critical urgency, intelligible"),
            Take("rc-spec.capture.01.wav", "rc-spec.capture.0", "Taking their controls apart.", "practical capture intent"),
            Take("rc-spec.capture.02.wav", "rc-spec.capture.1", "This site works for us now.", "dry certainty"),
            Take("rc-spec.capture.03.wav", "rc-spec.capture.2", "Cutting into the control box.", "physical technical action"),
            Take("rc-spec.repair.01.wav", "rc-spec.repair.0", "Patching the frame.", "direct repair intent"),
            Take("rc-spec.repair.02.wav", "rc-spec.repair.1", "Putting the machine back together.", "capable, workmanlike"),
            Take("rc-spec.repair.03.wav", "rc-spec.repair.2", "Give me a moment with it.", "calm dry confidence"),
        ), provider_voice_id="8t91ZRcCsF2NyYBUV5bl",
    ),
    "al-trans": Pack(
        pack_id="AL-TRANS", file_prefix="al-trans", display_name="VM_AL_TRANS_v1",
        generated_date="2026-08-26",
        generation_settings="ElevenLabs API; output_format=wav_48000; model=eleven_v3",
        source_note="Generated through project automation. Candidate 2 selected by the owner.",
        voice_design_prompt="Allied expeditionary transport loadmaster: clear medium-low voice, crisp contemporary diction, brisk delivery, protective and technically confident.",
        takes=(
            Take("al-trans.select.01.wav", "al-trans.select.0", "Lift crew online.", "attentive operational readiness"),
            Take("al-trans.select.02.wav", "al-trans.select.1", "Transport systems green.", "attentive operational readiness"),
            Take("al-trans.select.03.wav", "al-trans.select.2", "Passenger deck ready.", "attentive operational readiness"),
            Take("al-trans.select.04.wav", "al-trans.select.3", "Carrier standing by.", "attentive operational readiness"),
            Take("al-trans.move.01.wav", "al-trans.move.0", "Plotting the crossing.", "purposeful route confirmation"),
            Take("al-trans.move.02.wav", "al-trans.move.1", "Transport moving.", "purposeful route confirmation"),
            Take("al-trans.move.03.wav", "al-trans.move.2", "Route to shore confirmed.", "purposeful route confirmation"),
            Take("al-trans.attack.01.wav", "al-trans.attack.0", "Defensive weapons live.", "controlled combat commitment"),
            Take("al-trans.attack.02.wav", "al-trans.attack.1", "Engaging from the carrier.", "controlled combat commitment"),
            Take("al-trans.attack.03.wav", "al-trans.attack.2", "Covering the landing.", "controlled combat commitment"),
            Take("al-trans.stop.01.wav", "al-trans.stop.0", "Holding the transport.", "firm stop acknowledgement"),
            Take("al-trans.stop.02.wav", "al-trans.stop.1", "Carrier stopped.", "firm stop acknowledgement"),
            Take("al-trans.guard.01.wav", "al-trans.guard.0", "Screening the formation.", "protective guard acknowledgement"),
            Take("al-trans.guard.02.wav", "al-trans.guard.1", "Guard route accepted.", "protective guard acknowledgement"),
            Take("al-trans.patrol.01.wav", "al-trans.patrol.0", "Beginning coastal patrol.", "steady patrol acknowledgement"),
            Take("al-trans.patrol.02.wav", "al-trans.patrol.1", "Running the patrol line.", "steady patrol acknowledgement"),
            Take("al-trans.under-fire.01.wav", "al-trans.underFire.0", "Transport taking fire!", "urgent controlled alarm"),
            Take("al-trans.under-fire.02.wav", "al-trans.underFire.1", "Passenger deck under attack!", "urgent controlled alarm"),
            Take("al-trans.under-fire.03.wav", "al-trans.underFire.2", "We need escort now!", "urgent controlled alarm"),
            Take("al-trans.critical-damage.01.wav", "al-trans.criticalDamage.0", "Carrier integrity critical!", "critical urgency, clear and intelligible"),
            Take("al-trans.critical-damage.02.wav", "al-trans.criticalDamage.1", "Transport is going down!", "critical urgency, clear and intelligible"),
            Take("al-trans.unload.01.wav", "al-trans.unload.0", "Deploying the passengers.", "decisive unload acknowledgement"),
            Take("al-trans.unload.02.wav", "al-trans.unload.1", "Landing party away.", "decisive unload acknowledgement"),
            Take("al-trans.unload.03.wav", "al-trans.unload.2", "Clearing the passenger deck.", "decisive unload acknowledgement"),
        ), provider_voice_id="oAfbu7R1tAjeYwX48wGh",
    ),
    "sv-trans": Pack(
        pack_id="SV-TRANS", file_prefix="sv-trans", display_name="VM_SV_TRANS_v1",
        generated_date="2026-08-26",
        generation_settings="ElevenLabs API; output_format=wav_48000; model=eleven_v3",
        source_note="Generated through project automation. Candidate 2 selected by the owner.",
        voice_design_prompt="Soviet assault-barge master: dense low-mid voice, deliberate delivery, collective industrial authority and controlled urgency.",
        takes=(
            Take("sv-trans.select.01.wav", "sv-trans.select.0", "Transport crew ready.", "attentive operational readiness"),
            Take("sv-trans.select.02.wav", "sv-trans.select.1", "The troop deck is prepared.", "attentive operational readiness"),
            Take("sv-trans.select.03.wav", "sv-trans.select.2", "Carrier awaiting orders.", "attentive operational readiness"),
            Take("sv-trans.select.04.wav", "sv-trans.select.3", "We carry the advance.", "attentive operational readiness"),
            Take("sv-trans.move.01.wav", "sv-trans.move.0", "Set course for the crossing.", "purposeful route confirmation"),
            Take("sv-trans.move.02.wav", "sv-trans.move.1", "Transport advancing.", "purposeful route confirmation"),
            Take("sv-trans.move.03.wav", "sv-trans.move.2", "Take us to the shore.", "purposeful route confirmation"),
            Take("sv-trans.attack.01.wav", "sv-trans.attack.0", "Carrier guns engaging.", "controlled combat commitment"),
            Take("sv-trans.attack.02.wav", "sv-trans.attack.1", "Protect the troop deck.", "controlled combat commitment"),
            Take("sv-trans.attack.03.wav", "sv-trans.attack.2", "Fire across the landing.", "controlled combat commitment"),
            Take("sv-trans.stop.01.wav", "sv-trans.stop.0", "Holding the carrier.", "firm stop acknowledgement"),
            Take("sv-trans.stop.02.wav", "sv-trans.stop.1", "Engines to idle.", "firm stop acknowledgement"),
            Take("sv-trans.guard.01.wav", "sv-trans.guard.0", "We screen the formation.", "protective guard acknowledgement"),
            Take("sv-trans.guard.02.wav", "sv-trans.guard.1", "Guard course set.", "protective guard acknowledgement"),
            Take("sv-trans.patrol.01.wav", "sv-trans.patrol.0", "Begin the water patrol.", "steady patrol acknowledgement"),
            Take("sv-trans.patrol.02.wav", "sv-trans.patrol.1", "We hold the crossing lane.", "steady patrol acknowledgement"),
            Take("sv-trans.under-fire.01.wav", "sv-trans.underFire.0", "Transport under fire!", "urgent controlled alarm"),
            Take("sv-trans.under-fire.02.wav", "sv-trans.underFire.1", "They are hitting the troop deck!", "urgent controlled alarm"),
            Take("sv-trans.under-fire.03.wav", "sv-trans.underFire.2", "Escort the carrier!", "urgent controlled alarm"),
            Take("sv-trans.critical-damage.01.wav", "sv-trans.criticalDamage.0", "Carrier hull critical!", "critical urgency, clear and intelligible"),
            Take("sv-trans.critical-damage.02.wav", "sv-trans.criticalDamage.1", "We will not stay afloat!", "critical urgency, clear and intelligible"),
            Take("sv-trans.unload.01.wav", "sv-trans.unload.0", "Put the troops ashore.", "decisive unload acknowledgement"),
            Take("sv-trans.unload.02.wav", "sv-trans.unload.1", "Landing force away.", "decisive unload acknowledgement"),
            Take("sv-trans.unload.03.wav", "sv-trans.unload.2", "Clear the troop deck.", "decisive unload acknowledgement"),
        ), provider_voice_id="YUJe4GNA3qIat6BLJTvQ",
    ),
    "mr-trans": Pack(
        pack_id="MR-TRANS", file_prefix="mr-trans", display_name="VM_MR_TRANS_v1",
        generated_date="2026-08-26",
        generation_settings="ElevenLabs API; output_format=wav_48000; model=eleven_v3",
        source_note="Generated through project automation. Candidate 2 selected by the owner.",
        voice_design_prompt="Meridian carrier navigator: warm clear alto, carefully formed vowels, measured delivery, exact and protective with formal operational authority.",
        takes=(
            Take("mr-trans.select.01.wav", "mr-trans.select.0", "Passage vessel aligned.", "attentive operational readiness"),
            Take("mr-trans.select.02.wav", "mr-trans.select.1", "The passenger measure is ready.", "attentive operational readiness"),
            Take("mr-trans.select.03.wav", "mr-trans.select.2", "Carrier attentive.", "attentive operational readiness"),
            Take("mr-trans.select.04.wav", "mr-trans.select.3", "Embarkation systems balanced.", "attentive operational readiness"),
            Take("mr-trans.move.01.wav", "mr-trans.move.0", "Course across the water.", "purposeful route confirmation"),
            Take("mr-trans.move.02.wav", "mr-trans.move.1", "Carrying the formation onward.", "purposeful route confirmation"),
            Take("mr-trans.move.03.wav", "mr-trans.move.2", "Approach to shore aligned.", "purposeful route confirmation"),
            Take("mr-trans.attack.01.wav", "mr-trans.attack.0", "Defensive array committed.", "controlled combat commitment"),
            Take("mr-trans.attack.02.wav", "mr-trans.attack.1", "Screening the passage.", "controlled combat commitment"),
            Take("mr-trans.attack.03.wav", "mr-trans.attack.2", "Fire along the landing line.", "controlled combat commitment"),
            Take("mr-trans.stop.01.wav", "mr-trans.stop.0", "Holding the passage.", "firm stop acknowledgement"),
            Take("mr-trans.stop.02.wav", "mr-trans.stop.1", "Carrier at rest.", "firm stop acknowledgement"),
            Take("mr-trans.guard.01.wav", "mr-trans.guard.0", "Maintaining the protective course.", "protective guard acknowledgement"),
            Take("mr-trans.guard.02.wav", "mr-trans.guard.1", "Formation screen aligned.", "protective guard acknowledgement"),
            Take("mr-trans.patrol.01.wav", "mr-trans.patrol.0", "Beginning the horizon circuit.", "steady patrol acknowledgement"),
            Take("mr-trans.patrol.02.wav", "mr-trans.patrol.1", "Holding the patrol measure.", "steady patrol acknowledgement"),
            Take("mr-trans.under-fire.01.wav", "mr-trans.underFire.0", "Passage vessel under fire!", "urgent controlled alarm"),
            Take("mr-trans.under-fire.02.wav", "mr-trans.underFire.1", "The passenger deck is exposed!", "urgent controlled alarm"),
            Take("mr-trans.under-fire.03.wav", "mr-trans.underFire.2", "We require an escort!", "urgent controlled alarm"),
            Take("mr-trans.critical-damage.01.wav", "mr-trans.criticalDamage.0", "Carrier balance critical!", "critical urgency, clear and intelligible"),
            Take("mr-trans.critical-damage.02.wav", "mr-trans.criticalDamage.1", "The passage vessel is failing!", "critical urgency, clear and intelligible"),
            Take("mr-trans.unload.01.wav", "mr-trans.unload.0", "Releasing the landing group.", "decisive unload acknowledgement"),
            Take("mr-trans.unload.02.wav", "mr-trans.unload.1", "Passage complete, deploy.", "decisive unload acknowledgement"),
            Take("mr-trans.unload.03.wav", "mr-trans.unload.2", "Clearing the passenger measure.", "decisive unload acknowledgement"),
        ), provider_voice_id="my89qXcGRg549bfaYeob",
    ),
    "rc-trans": Pack(
        pack_id="RC-TRANS", file_prefix="rc-trans", display_name="VM_RC_TRANS_v1",
        generated_date="2026-08-26",
        generation_settings="ElevenLabs API; output_format=wav_48000; model=eleven_v3",
        source_note="Generated through project automation. Candidate 1 selected by the owner.",
        voice_design_prompt="Reclamation workboat operator: textured medium-low voice, clipped delivery, practical, protective and dryly confident with controlled grit.",
        takes=(
            Take("rc-trans.select.01.wav", "rc-trans.select.0", "Hauler crew checked in.", "attentive operational readiness"),
            Take("rc-trans.select.02.wav", "rc-trans.select.1", "Passenger rack ready.", "attentive operational readiness"),
            Take("rc-trans.select.03.wav", "rc-trans.select.2", "The lift rig is running.", "attentive operational readiness"),
            Take("rc-trans.select.04.wav", "rc-trans.select.3", "Show us the next crossing.", "attentive operational readiness"),
            Take("rc-trans.move.01.wav", "rc-trans.move.0", "Hauling for the far bank.", "purposeful route confirmation"),
            Take("rc-trans.move.02.wav", "rc-trans.move.1", "Carrier moving.", "purposeful route confirmation"),
            Take("rc-trans.move.03.wav", "rc-trans.move.2", "Taking the wet road.", "purposeful route confirmation"),
            Take("rc-trans.attack.01.wav", "rc-trans.attack.0", "Deck gun on the job.", "controlled combat commitment"),
            Take("rc-trans.attack.02.wav", "rc-trans.attack.1", "Cover the unloading side.", "controlled combat commitment"),
            Take("rc-trans.attack.03.wav", "rc-trans.attack.2", "Firing across the beach.", "controlled combat commitment"),
            Take("rc-trans.stop.01.wav", "rc-trans.stop.0", "Parking the hauler.", "firm stop acknowledgement"),
            Take("rc-trans.stop.02.wav", "rc-trans.stop.1", "Carrier holding.", "firm stop acknowledgement"),
            Take("rc-trans.guard.01.wav", "rc-trans.guard.0", "Keeping the convoy covered.", "protective guard acknowledgement"),
            Take("rc-trans.guard.02.wav", "rc-trans.guard.1", "Guarding the loaded rig.", "protective guard acknowledgement"),
            Take("rc-trans.patrol.01.wav", "rc-trans.patrol.0", "Working the water line.", "steady patrol acknowledgement"),
            Take("rc-trans.patrol.02.wav", "rc-trans.patrol.1", "Running the crossing route.", "steady patrol acknowledgement"),
            Take("rc-trans.under-fire.01.wav", "rc-trans.underFire.0", "Hauler taking hits!", "urgent controlled alarm"),
            Take("rc-trans.under-fire.02.wav", "rc-trans.underFire.1", "They're tearing up the passenger rack!", "urgent controlled alarm"),
            Take("rc-trans.under-fire.03.wav", "rc-trans.underFire.2", "Need cover on the carrier!", "urgent controlled alarm"),
            Take("rc-trans.critical-damage.01.wav", "rc-trans.criticalDamage.0", "Lift rig critical!", "critical urgency, clear and intelligible"),
            Take("rc-trans.critical-damage.02.wav", "rc-trans.criticalDamage.1", "We're losing the whole hauler!", "critical urgency, clear and intelligible"),
            Take("rc-trans.unload.01.wav", "rc-trans.unload.0", "Get the crew off the rack.", "decisive unload acknowledgement"),
            Take("rc-trans.unload.02.wav", "rc-trans.unload.1", "Dropping the landing party.", "decisive unload acknowledgement"),
            Take("rc-trans.unload.03.wav", "rc-trans.unload.2", "Empty the carrier, now.", "decisive unload acknowledgement"),
        ), provider_voice_id="twmU7x0N00CcI5Ompbpw",
    ),
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def amplitude_db(value: float) -> float:
    return 20.0 * math.log10(max(value, 1e-12))


def resample_linear(audio: np.ndarray, source_rate: int, output_rate: int) -> np.ndarray:
    """Deterministic resampling adequate for speech low-passed to 2.5 kHz in-game."""
    if source_rate == output_rate:
        return audio
    output_count = max(1, round(len(audio) * output_rate / source_rate))
    source_positions = np.arange(len(audio), dtype=np.float64)
    output_positions = np.arange(output_count, dtype=np.float64) * source_rate / output_rate
    return np.interp(output_positions, source_positions, audio).astype(np.float64)


def trim_and_pad(audio: np.ndarray, sample_rate: int) -> tuple[np.ndarray, float, float]:
    frame = max(1, round(sample_rate * 0.01))
    frame_count = math.ceil(len(audio) / frame)
    padded = np.pad(audio, (0, frame_count * frame - len(audio)))
    frames = padded.reshape(frame_count, frame)
    frame_rms = np.sqrt(np.mean(frames * frames, axis=1))
    active = np.flatnonzero(frame_rms >= 10.0 ** (ACTIVE_THRESHOLD_DB / 20.0))
    if len(active) == 0:
        raise ValueError("no speech found above the active threshold")

    raw_start = int(active[0] * frame)
    raw_end = min(len(audio), int((active[-1] + 1) * frame))
    lead_before = raw_start / sample_rate * 1000.0
    tail_before = (len(audio) - raw_end) / sample_rate * 1000.0
    speech = audio[raw_start:raw_end]
    lead = np.zeros(round(sample_rate * LEAD_MS / 1000.0), dtype=np.float64)
    tail = np.zeros(round(sample_rate * TAIL_MS / 1000.0), dtype=np.float64)
    return np.concatenate((lead, speech, tail)), lead_before, tail_before


def compress_tempo(audio: np.ndarray, sample_rate: int, factor: float, ffmpeg: Path | None) -> np.ndarray:
    """Shorten a long performance without raising its pitch."""
    if ffmpeg is None or not ffmpeg.is_file():
        raise RuntimeError(
            f"this take needs pitch-preserving tempo compression ({factor:.3f}x); "
            "install ffmpeg or pass --ffmpeg C:/path/to/ffmpeg.exe"
        )
    with tempfile.TemporaryDirectory(prefix="voltmarch-voice-") as directory:
        source = Path(directory) / "source.wav"
        output = Path(directory) / "tempo.wav"
        sf.write(source, audio.astype(np.float32), sample_rate, format="WAV", subtype="FLOAT")
        subprocess.run(
            [
                str(ffmpeg), "-hide_banner", "-loglevel", "error", "-y",
                "-i", str(source), "-filter:a", f"atempo={factor:.8f}", str(output),
            ],
            check=True,
        )
        result, result_rate = sf.read(output, dtype="float64")
        if result_rate != sample_rate:
            raise RuntimeError(f"ffmpeg changed the sample rate to {result_rate}")
        return result


def prepare_take(source_dir: Path, take: Take, output_dir: Path, ffmpeg: Path | None) -> dict[str, object]:
    source = source_dir / take.source
    if not source.is_file():
        raise FileNotFoundError(source)

    info = sf.info(source)
    decoded, sample_rate = sf.read(source, dtype="float64", always_2d=True)
    mono = np.mean(decoded, axis=1)
    mono -= float(np.mean(mono))
    trimmed, source_lead_ms, source_tail_ms = trim_and_pad(mono, sample_rate)
    processed = resample_linear(trimmed, sample_rate, OUTPUT_RATE)
    tempo_factor = 1.0
    if len(processed) / OUTPUT_RATE > MAX_DELIVERY_SECONDS:
        tempo_factor = (len(processed) / OUTPUT_RATE) / TEMPO_TARGET_SECONDS
        processed = compress_tempo(processed, OUTPUT_RATE, tempo_factor, ffmpeg)

    rms = float(np.sqrt(np.mean(processed * processed)))
    peak = float(np.max(np.abs(processed)))
    gain_db = min(TARGET_RMS_DB - amplitude_db(rms), PEAK_CEILING_DB - amplitude_db(peak))
    processed *= 10.0 ** (gain_db / 20.0)

    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / f"{take.output_id}.ogg"
    sf.write(
        output,
        processed.astype(np.float32),
        OUTPUT_RATE,
        format="OGG",
        subtype="VORBIS",
        compression_level=0.66,
    )

    final, final_rate = sf.read(output, dtype="float64", always_2d=True)
    final_mono = np.mean(final, axis=1)
    return {
        "sourceFile": take.source,
        "sourceSha256": sha256(source),
        "sourceContainer": info.format,
        "sourceSubtype": info.subtype,
        "sourceSampleRate": sample_rate,
        "sourceChannels": info.channels,
        "sourceDurationSeconds": round(info.duration, 4),
        "sourceLeadSilenceMs": round(source_lead_ms),
        "sourceTailSilenceMs": round(source_tail_ms),
        "transcript": take.transcript,
        "direction": take.direction,
        "deliveryFile": output.name,
        "deliverySha256": sha256(output),
        "deliverySampleRate": final_rate,
        "deliveryChannels": final.shape[1],
        "deliveryDurationSeconds": round(len(final_mono) / final_rate, 4),
        "deliveryPeakDbfs": round(amplitude_db(float(np.max(np.abs(final_mono)))), 2),
        "deliveryRmsDbfs": round(amplitude_db(float(np.sqrt(np.mean(final_mono * final_mono)))), 2),
        "appliedGainDb": round(gain_db, 2),
        "tempoFactor": round(tempo_factor, 4),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_dir", type=Path)
    parser.add_argument("--pack", choices=sorted(PACKS), default="al-arm")
    parser.add_argument("--output", type=Path, default=OUTPUT_DIR)
    parser.add_argument("--provenance", type=Path)
    parser.add_argument("--ffmpeg", type=Path, default=shutil.which("ffmpeg"))
    args = parser.parse_args()

    pack = PACKS[args.pack]
    provenance_file = args.provenance or Path(f"docs/voice/generated/{pack.pack_id}_v1.json")
    records = [prepare_take(args.source_dir, take, args.output, args.ffmpeg) for take in pack.takes]
    provenance = {
        "schemaVersion": 1,
        "packId": pack.pack_id,
        "productionVersion": "v1",
        "displayName": pack.display_name,
        "generatedDate": pack.generated_date,
        "provider": "ElevenLabs",
        "providerVoiceId": pack.provider_voice_id,
        "model": "eleven_v3",
        "generationSettings": pack.generation_settings,
        "rights": "User-supplied generation made under the project owner's paid ElevenLabs account.",
        "sourceNote": pack.source_note,
        "voiceDesignPrompt": pack.voice_design_prompt,
        "processing": {
            "script": "tools/prepare-voice-pack.py",
            "output": "mono 48 kHz Ogg Vorbis",
            "targetRmsDbfs": TARGET_RMS_DB,
            "peakCeilingDbfs": PEAK_CEILING_DB,
            "leadMs": LEAD_MS,
            "tailMs": TAIL_MS,
            "maxDeliverySeconds": MAX_DELIVERY_SECONDS,
            "tempoPolicy": "pitch-preserving ffmpeg atempo only when a take exceeds the maximum",
        },
        "takes": records,
    }
    provenance_file.parent.mkdir(parents=True, exist_ok=True)
    provenance_file.write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")

    for record in records:
        print(
            f"{record['deliveryFile']}: {record['deliveryDurationSeconds']:.3f}s, "
            f"{record['deliveryRmsDbfs']:+.2f} dBFS RMS, "
            f"{record['deliveryPeakDbfs']:+.2f} dBFS peak"
        )


if __name__ == "__main__":
    main()
