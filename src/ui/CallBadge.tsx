import { useEffect, useState } from 'preact/hooks';
import { config } from '../config';
import type { CalendarEvent } from '../gmail/types';
import { t } from '../i18n';
import { api } from '../store';
import { CIcon } from './ColorIcons';
import { joinLink } from './SidePanel';

const BEFORE = 15 * 60_000; // show from 15 minutes before the start…
const AFTER = 10 * 60_000; // …until 10 minutes after it
const REFETCH = 5 * 60_000;

interface Call {
  e: CalendarEvent;
  url: string;
  start: number;
}

/** The video call starting within 15 minutes, or started within the last 10, if any. */
function pick(events: CalendarEvent[], now: number): Call | undefined {
  let best: Call | undefined;
  for (const e of events) {
    if (!e.start?.dateTime) continue; // all-day events have no call time
    if (e.attendees?.some((a) => a.self && a.responseStatus === 'declined')) continue;
    const start = new Date(e.start.dateTime).getTime();
    const end = e.end?.dateTime ? new Date(e.end.dateTime).getTime() : Infinity;
    if (now < start - BEFORE || now > start + AFTER || now > end) continue;
    const url = joinLink(e);
    if (!url) continue;
    // Prefer the call that is about to start over one that started a while ago.
    if (!best || Math.abs(start - now) < Math.abs(best.start - now)) best = { e, url, start };
  }
  return best;
}

/** A Join badge next to the profile picture when a video call is about to start or just started. */
export function CallBadge() {
  const on = config.features.calendar || config.demo;
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!on) return;
    let last = 0;
    const load = () => {
      if (document.hidden || !navigator.onLine) return;
      last = Date.now();
      api.todayEvents().then(setEvents).catch(() => {}); // quiet: the badge is a convenience
    };
    load();
    const tick = setInterval(() => {
      setNow(Date.now());
      if (Date.now() - last >= REFETCH) load();
    }, 30_000);
    const wake = () => {
      setNow(Date.now());
      if (!document.hidden && Date.now() - last >= 60_000) load();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
    };
  }, [on]);

  if (!on) return null;
  const call = pick(events, now);
  if (!call) return null;
  const mins = Math.ceil((call.start - now) / 60_000);
  const when = mins > 0 ? t('call.soon', { n: mins }) : t('call.now');
  const name = call.e.summary || t('panel.noTitle');
  const label = t('call.badge', { name, when });
  return (
    <a
      class={`call-badge ${mins > 0 ? '' : 'live'}`}
      href={call.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
    >
      <span class="call-ic" aria-hidden="true"><CIcon name="meet" size={18} /></span>
      <span class="call-txt">
        <b>{t('panel.join')}</b>
        {call.e.color && <span class="call-dot" style={{ background: call.e.color }} aria-hidden="true" />}
        <span class="call-name">{name}</span>
      </span>
      <span class="call-when">{when}</span>
    </a>
  );
}
