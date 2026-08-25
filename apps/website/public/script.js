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
})();
