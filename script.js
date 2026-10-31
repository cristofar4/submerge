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
  };
  toggle.addEventListener('click', () => setMenu(!nav.classList.contains('is-open')));
  $('#navLinks').addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
  document.addEventListener('click', (e) => { if (!nav.contains(e.target)) setMenu(false); });

  /* ---------- highlight the nav link for the section in view ---------- */
  const navAnchors = [...document.querySelectorAll('.nav__links a[href^="#"]:not(.nav__mobile-cta)')];
  const sections = [...document.querySelectorAll('main > section[id]')];
  if ('IntersectionObserver' in window) {
    const sio = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        navAnchors.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === '#' + en.target.id));
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach((s) => sio.observe(s));
  }

  /* ---------- depth gauge follows scroll ---------- */
  const marker = $('#gaugeMarker');
  let ticking = false;
  const onScroll = () => {
    const y = window.scrollY;
    nav.classList.toggle('is-solid', y > 40);
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const p = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0;
    marker.style.top = (p * 100) + '%';
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

  /* ---------- parallax: photos drift inside their frames ---------- */
  const plxImgs = [...document.querySelectorAll('.window__main img, .window__secondary img, .card__img img, .suite__img img, .dining__media img, .reef__media img')];
  if (!reduceMotion && plxImgs.length) {
    let plxQueued = false;
    const plx = () => {
      plxQueued = false;
      const vh = window.innerHeight;
      plxImgs.forEach((img) => {
        const r = img.parentElement.getBoundingClientRect();
        if (r.bottom < -100 || r.top > vh + 100) return;
        const prog = (r.top + r.height / 2 - vh / 2) / (vh / 2 + r.height / 2); // -1 .. 1
        img.style.setProperty('--py', (-prog * r.height * 0.045).toFixed(1) + 'px');
      });
    };
    const queue = () => { if (!plxQueued) { plxQueued = true; requestAnimationFrame(plx); } };
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue);
    plx();
  }

  /* ---------- count-up figures ---------- */
  const counters = document.querySelectorAll('.count');
  if (!reduceMotion && 'IntersectionObserver' in window) {
    const cio = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        cio.unobserve(en.target);
        const el = en.target;
        const to = +el.dataset.to;
        const t0 = performance.now();
        const dur = 1600;
        const tick = (t) => {
          const k = Math.min(1, (t - t0) / dur);
          el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3)));
          if (k < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    }, { threshold: 0.6 });
    counters.forEach((el) => cio.observe(el));
  }

  /* ---------- newsletter ---------- */
  const news = $('#newsletter');
  const newsEmail = $('#newsEmail');
  const newsMsg = $('#newsMsg');
  news.addEventListener('submit', (e) => {
    e.preventDefault();
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newsEmail.value.trim());
    newsMsg.classList.toggle('is-error', !ok);
    newsMsg.textContent = ok ? 'Thank you. You are on the list.' : 'Please enter a valid email address.';
    if (ok) news.reset();
  });

  /* ---------- contact form ---------- */
  // Set data-endpoint on the form (e.g. a Formspree or your own API URL) to deliver enquiries.
  const contact = $('#contactForm');
  const fields = $('#contactFields');
  const done = $('#contactDone');
  const status = $('#contactStatus');
  const submitBtn = $('#contactSubmit');
  const consent = $('#cConsent');
  const consentError = $('#consentError');
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  $('#cDate').min = iso(today);

  const checks = {
    cFirst: (v) => v.trim().length > 0,
    cLast: (v) => v.trim().length > 0,
    cEmail: (v) => emailRe.test(v.trim()),
    cTopic: (v) => v !== '',
    cMessage: (v) => v.trim().length > 1,
  };
  const validate = (id) => {
    const el = document.getElementById(id);
    const ok = checks[id](el.value);
    el.closest('.field').classList.toggle('is-invalid', !ok);
    el.setAttribute('aria-invalid', String(!ok));
    return ok;
  };
  Object.keys(checks).forEach((id) => {
    const el = document.getElementById(id);
    const evt = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(evt, () => { if (el.closest('.field').classList.contains('is-invalid')) validate(id); });
  });
  consent.addEventListener('change', () => consentError.classList.toggle('is-shown', !consent.checked));

  contact.addEventListener('submit', async (e) => {
    e.preventDefault();
    status.textContent = '';
    const results = Object.keys(checks).map(validate);
    consentError.classList.toggle('is-shown', !consent.checked);
    if (results.includes(false) || !consent.checked) {
      const firstBad = contact.querySelector('[aria-invalid="true"]') || consent;
      firstBad.focus();
      return;
    }

    const endpoint = contact.dataset.endpoint;
    if (endpoint) {
      submitBtn.disabled = true;
      try {
        const res = await fetch(endpoint, { method: 'POST', body: new FormData(contact), headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(res.status);
      } catch (_) {
        status.textContent = "We couldn't send your message. Please try again, or email reservations@submerge.com.";
        submitBtn.disabled = false;
        return;
      }
      submitBtn.disabled = false;
    }

    $('#contactDoneTitle').textContent = `Thank you, ${$('#cFirst').value.trim()}.`;
    $('#contactDoneEmail').textContent = $('#cEmail').value.trim();
    fields.hidden = true;
    done.hidden = false;
    done.focus();
  });

  $('#contactAgain').addEventListener('click', () => {
    contact.reset();
    contact.querySelectorAll('.is-invalid').forEach((f) => f.classList.remove('is-invalid'));
    done.hidden = true;
    fields.hidden = false;
    $('#cFirst').focus();
  });

  $('#year').textContent = new Date().getFullYear();
})();
