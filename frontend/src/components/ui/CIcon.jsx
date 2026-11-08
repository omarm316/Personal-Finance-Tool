/* Line icons for the Cloud-look pages (same set as the design galleries). */
const P={
  search:<><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></>,
  plus:<path d="M12 5v14M5 12h14"/>,
  up:<path d="M12 19V5M5 12l7-7 7 7"/>,
  dots:<><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></>,
  edit:<><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></>,
  split:<><path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.2-2.9L3 3"/><path d="m15 9 6-6"/></>,
  info:<><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></>,
  check:<path d="M20 6 9 17l-5-5"/>,
  ban:<><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></>,
  alert:<><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></>,
  x:<path d="M18 6 6 18M6 6l12 12"/>,
  down:<path d="m6 9 6 6 6-6"/>,
};

export function CIcon({name,size=16}){
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{P[name]}</svg>;
}
