(() => {
  const header = document.querySelector('[data-header]');
  const year = document.querySelector('[data-year]');
  if (year) year.textContent = String(new Date().getFullYear());
  const setHeader = () => header?.classList.toggle('is-scrolled', window.scrollY > 48);
  setHeader();
  window.addEventListener('scroll', setHeader, { passive: true });

  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });
    document.querySelectorAll('.reveal').forEach((node) => observer.observe(node));
  } else {
    document.querySelectorAll('.reveal').forEach((node) => node.classList.add('is-visible'));
  }

  const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u.test(value) && value.length <= 254;
  document.querySelectorAll('[data-signup-form]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const status = form.querySelector('[data-form-status]');
      const button = form.querySelector('button[type="submit"]');
      const data = new FormData(form);
      const email = String(data.get('email') || '').trim();
      status.classList.remove('is-error');
      if (!validEmail(email)) {
        status.textContent = 'Enter a valid email address to join command.';
        status.classList.add('is-error');
        form.querySelector('input[name="email"]')?.focus();
        return;
      }
      button.disabled = true;
      status.textContent = 'Opening secure channel…';
      try {
        const response = await fetch('/api/subscribe', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ email, company: String(data.get('company') || ''), source: String(data.get('source') || 'site') }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'The channel did not open. Try again.');
        status.textContent = result.existing ? 'You are already on the command list.' : 'Signal received. Welcome to command.';
        form.reset();
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : 'The channel did not open. Try again.';
        status.classList.add('is-error');
      } finally {
        button.disabled = false;
      }
    });
  });

  const archive = document.querySelector('[data-card-archive]');
  if (archive) {
    const consoleNode = archive.querySelector('.archive-console');
    const stage = archive.querySelector('[data-card-stage]');
    const image = archive.querySelector('[data-card-image]');
    const position = archive.querySelector('[data-card-position]');
    const toggle = archive.querySelector('[data-slide-toggle]');
    const playIcon = archive.querySelector('[data-play-icon]');
    const playLabel = archive.querySelector('[data-play-label]');
    const error = archive.querySelector('[data-archive-error]');
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const factionLabels = {
      allies: 'Allied Forces',
      soviets: 'Soviet Union',
      'meridian-pact': 'Meridian Pact',
      reclamation: 'Reclamation Directorate',
    };
    const typeLabels = {
      infantry: 'Infantry', vehicles: 'Vehicle', aircraft: 'Aircraft', ships: 'Naval vessel',
      buildings: 'Production structure', defences: 'Defensive structure',
    };
    let cards = [];
    let filteredCards = [];
    let currentIndex = 0;
    let factionFilter = 'all';
    let typeFilter = 'all';
    let playing = !prefersReducedMotion;
    let pointerInside = false;

    const setPlaying = (nextPlaying) => {
      playing = nextPlaying;
      toggle?.setAttribute('aria-pressed', String(playing));
      if (playIcon) playIcon.textContent = playing ? 'Ⅱ' : '▶';
      if (playLabel) playLabel.textContent = playing ? 'Pause rotation' : 'Resume rotation';
    };

    const preloadNeighbor = (offset) => {
      if (filteredCards.length < 2) return;
      const candidate = filteredCards[(currentIndex + offset + filteredCards.length) % filteredCards.length];
      const preload = new Image();
      preload.src = candidate.image;
    };

    const renderCard = (direction = 0) => {
      if (!filteredCards.length) return;
      currentIndex = (currentIndex + filteredCards.length) % filteredCards.length;
      const card = filteredCards[currentIndex];
      archive.dataset.faction = card.faction;
      stage?.querySelectorAll('.card-image-outgoing').forEach((outgoing) => outgoing.remove());
      if (direction && image.dataset.ready === 'true') {
        const outgoing = image.cloneNode();
        outgoing.removeAttribute('data-card-image');
        outgoing.removeAttribute('alt');
        outgoing.setAttribute('aria-hidden', 'true');
        outgoing.className = `card-image-outgoing card-image-outgoing--${direction > 0 ? 'forward' : 'backward'}`;
        stage?.append(outgoing);
        window.setTimeout(() => outgoing.remove(), 520);
      }
      image.classList.remove('card-image-entering--forward', 'card-image-entering--backward');
      stage?.classList.add('is-changing');
      image.onload = () => {
        stage?.classList.remove('is-changing');
        image.dataset.ready = 'true';
        if (!direction) return;
        void image.offsetWidth;
        image.classList.add(`card-image-entering--${direction > 0 ? 'forward' : 'backward'}`);
      };
      image.src = card.image;
      image.alt = `${card.name}, ${factionLabels[card.faction]} ${typeLabels[card.type]} collectible card`;
      image.width = card.width;
      image.height = card.height;
      if (position) position.textContent = `${String(currentIndex + 1).padStart(3, '0')} / ${String(filteredCards.length).padStart(3, '0')}`;
      preloadNeighbor(1);
      preloadNeighbor(-1);
    };

    const move = (direction) => {
      if (!filteredCards.length) return;
      currentIndex += direction;
      renderCard(direction);
    };

    const applyFilters = () => {
      filteredCards = cards.filter((card) => (
        (factionFilter === 'all' || card.faction === factionFilter)
        && (typeFilter === 'all' || card.type === typeFilter)
      ));
      currentIndex = 0;
      renderCard(cards.length === filteredCards.length ? 0 : 1);
    };

    archive.querySelectorAll('[data-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        const filter = button.dataset.filter;
        const value = button.dataset.value;
        archive.querySelectorAll(`[data-filter="${filter}"]`).forEach((candidate) => {
          candidate.setAttribute('aria-pressed', String(candidate === button));
        });
        if (filter === 'faction') factionFilter = value;
        if (filter === 'type') typeFilter = value;
        applyFilters();
      });
    });
    archive.querySelectorAll('[data-slide-previous]').forEach((button) => button.addEventListener('click', () => move(-1)));
    archive.querySelectorAll('[data-slide-next]').forEach((button) => button.addEventListener('click', () => move(1)));
    toggle?.addEventListener('click', () => setPlaying(!playing));
    stage?.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      move(event.key === 'ArrowLeft' ? -1 : 1);
    });
    stage?.addEventListener('pointerenter', () => { pointerInside = true; });
    stage?.addEventListener('pointerleave', () => { pointerInside = false; });
    setPlaying(playing);
    window.setInterval(() => {
      if (playing && !pointerInside && document.visibilityState === 'visible') move(1);
    }, 6500);

    fetch('/cards/manifest.json', { headers: { accept: 'application/json' } })
      .then((response) => {
        if (!response.ok) throw new Error('The field archive is temporarily unavailable.');
        return response.json();
      })
      .then((manifest) => {
        if (!Array.isArray(manifest.cards) || !manifest.cards.length) throw new Error('No field cards were received.');
        cards = manifest.cards;
        consoleNode?.setAttribute('aria-busy', 'false');
        applyFilters();
      })
      .catch((requestError) => {
        consoleNode?.setAttribute('aria-busy', 'false');
        if (error) error.textContent = requestError instanceof Error ? requestError.message : 'The field archive is temporarily unavailable.';
      });
  }
})();
