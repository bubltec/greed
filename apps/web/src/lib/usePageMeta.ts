import { useEffect } from 'react';
import type { PageDocument } from '@greed/domain';

function setMeta(attr: 'name' | 'property', key: string, content: string) {
  const selector = `meta[${attr}="${key}"]`;
  let el = document.head.querySelector(selector);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setCanonical(href: string) {
  let el = document.head.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

/** Keeps the document head in step with the page after a client-side navigation. */
export function usePageMeta(doc: Pick<PageDocument, 'title' | 'description' | 'path' | 'robots' | 'type'> | undefined) {
  const title = doc?.title;
  const description = doc?.description;
  const path = doc?.path;
  const robots = doc?.robots;
  const type = doc?.type;
  useEffect(() => {
    if (!title || !description || !path || !robots || !type) return;
    document.title = title;
    const url = `${window.location.origin}${path}`;
    setMeta('name', 'description', description);
    setMeta('name', 'robots', robots);
    setMeta('property', 'og:site_name', 'GREED');
    setMeta('property', 'og:title', title);
    setMeta('property', 'og:description', description);
    setMeta('property', 'og:url', url);
    setMeta('property', 'og:type', type);
    setMeta('name', 'twitter:card', 'summary');
    setMeta('name', 'twitter:title', title);
    setMeta('name', 'twitter:description', description);
    setCanonical(url);
  }, [title, description, path, robots, type]);
}
