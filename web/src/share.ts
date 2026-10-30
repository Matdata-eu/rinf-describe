// Share: copy the link to this page (with its tab), or the native share sheet on phones.
const toastEl = () => document.getElementById('toast') as HTMLDivElement;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(text: string, ms = 3200) {
  const el = toastEl();
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

/** What the link opens, for the confirmation. */
function what(): string {
  if (location.pathname !== '/describe') return 'It opens the start page.';
  const title = document.querySelector('.page-head h1')?.textContent?.trim();
  const tab = document.querySelector('.tabs .tab[aria-selected="true"]')?.firstChild?.textContent?.trim();
  const page = title ? `the page of ${title}` : 'this page';
  return `It opens ${page}${tab && tab !== 'Overview' ? `, on ${tab}` : ''}.`;
}

export async function share() {
  const url = location.href;
  // Phones and tablets: the system share sheet (mail, chat apps...); elsewhere the clipboard.
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ title: document.title, url }); return; } catch (e) {
      if ((e as DOMException).name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast(`Link copied. ${what()}`);
  } catch {
    window.prompt('Copy this link to share the page:', url);
  }
}
