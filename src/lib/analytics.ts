export type AnalyticsEvent = 'open_margins' | 'save_post' | 'share_quote' | 'react' | 'explore' | 'newsletter_signup';

export function track(event: AnalyticsEvent, data: Record<string, string | number | boolean> = {}) {
  window.dispatchEvent(new CustomEvent('second-ink:analytics', { detail: { event, data } }));
}
