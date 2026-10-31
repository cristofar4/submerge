(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- nav: solid on scroll + mobile menu ---------- */
  const nav = $('#nav');
  const toggle = $('#navToggle');
  const setMenu = (open) => {
    nav.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    document.body.style.overflow = open ? 'hidden' : '';
  };
  toggle.addEventListener('click', () => setMenu(!nav.classList.contains('is-open')));
  $('#navLinks').addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });

  /* ---------- depth gauge follows scroll ---------- */
  const marker = $('#gaugeMarker');
  const readout = $('#gaugeReadout');
  const MAX_DEPTH = 40;
  let ticking = false;
  const onScroll = () => {
    const y = window.scrollY;
    nav.classList.toggle('is-solid', y > 40);
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const p = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0;
    marker.style.top = (p * 100) + '%';
    readout.textContent = Math.round(p * MAX_DEPTH) + ' m';
    ticking = false;
  };
  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
  }, { passive: true });
  onScroll();

  /* ---------- reveal on scroll ---------- */
  const revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduceMotion) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('is-in'));
  }

  /* ---------- videos: respect reduced motion, pause offscreen ---------- */
  const videos = document.querySelectorAll('video');
  if (reduceMotion) {
    videos.forEach((v) => { v.removeAttribute('autoplay'); v.pause(); });
  } else if ('IntersectionObserver' in window) {
    const vio = new IntersectionObserver((entries) => {
      entries.forEach(({ target, isIntersecting }) => {
        if (isIntersecting) {
          if (target.preload === 'none') { target.preload = 'auto'; target.load(); }
          target.play().catch(() => {});
        } else {
          target.pause();
        }
      });
    }, { threshold: 0.05 });
    videos.forEach((v) => vio.observe(v));
  }

  /* ---------- booking form ---------- */
  const form = $('#bookingForm');
  const arrival = $('#arrival');
  const departure = $('#departure');
  const guests = $('#guests');
  const msg = $('#bookingMsg');

  const iso = (d) => {
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
  };
  const today = new Date();
  arrival.min = iso(today);
  departure.min = iso(new Date(today.getTime() + 86400000));

  // "Arrival"/"Departure" placeholders for empty date inputs
  [arrival, departure].forEach((input) => {
    const field = input.closest('label');
    const sync = () => field.classList.toggle('is-empty', !input.value);
    input.addEventListener('input', sync);
    input.addEventListener('change', sync);
    sync();
    // open the native picker when clicking anywhere in the field
    field.addEventListener('click', () => {
      if (typeof input.showPicker === 'function') { try { input.showPicker(); } catch (_) {} }
    });
  });

  arrival.addEventListener('change', () => {
    if (!arrival.value) return;
    const next = new Date(arrival.value + 'T00:00:00');
    next.setDate(next.getDate() + 1);
    departure.min = iso(next);
    if (departure.value && departure.value <= arrival.value) {
      departure.value = '';
      departure.closest('label').classList.add('is-empty');
    }
  });

  const show = (text, isError) => {
    msg.textContent = text;
    msg.classList.toggle('is-error', !!isError);
    msg.classList.add('is-shown');
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!arrival.value) return show('Please choose an arrival date.', true);
    if (!departure.value) return show('Please choose a departure date.', true);
    if (departure.value <= arrival.value) return show('Departure must be after arrival.', true);
    if (!guests.value) return show('Please select the number of guests.', true);

    const nights = Math.round((new Date(departure.value) - new Date(arrival.value)) / 86400000);
    const fmt = (v) => new Date(v + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    show(`Suites are available ${fmt(arrival.value)} – ${fmt(departure.value)} · ${nights} night${nights > 1 ? 's' : ''}, ${guests.value} guest${guests.value > 1 ? 's' : ''}. Our concierge will be in touch.`);
  });

  $('#year').textContent = new Date().getFullYear();
})();
