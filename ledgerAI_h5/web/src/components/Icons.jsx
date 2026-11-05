const base = { width: 24, height: 24, viewBox: '0 0 24 24' };

export const HomeIcon = (p) => (
  <svg {...base} fill="currentColor" {...p}><path d="M12 2.8 2.6 10.9a.8.8 0 0 0 .5 1.4H5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-7.7h1.9a.8.8 0 0 0 .5-1.4z" /></svg>
);
export const ChartIcon = (p) => (
  <svg {...base} fill="currentColor" {...p}>
    <rect x="3.5" y="12" width="4.5" height="9" rx="1.2" /><rect x="9.75" y="3" width="4.5" height="18" rx="1.2" /><rect x="16" y="8" width="4.5" height="13" rx="1.2" />
  </svg>
);
export const PersonIcon = (p) => (
  <svg {...base} fill="currentColor" {...p}><circle cx="12" cy="7.5" r="4.2" /><path d="M3.8 21c0-4.3 3.7-6.8 8.2-6.8s8.2 2.5 8.2 6.8z" /></svg>
);
export const ChevronRight = (p) => (
  <svg {...base} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M9 4.5 16.5 12 9 19.5" /></svg>
);
export const ChevronLeft = (p) => (
  <svg {...base} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M15 4.5 7.5 12 15 19.5" /></svg>
);
export const CameraIcon = (p) => (
  <svg {...base} fill="currentColor" fillRule="evenodd" {...p}>
    <path d="M9 4 7.6 6H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2.6L15 4zm3 5a3.6 3.6 0 1 0 0 7.2A3.6 3.6 0 0 0 12 9z" />
  </svg>
);
export const PhotoIcon = (p) => (
  <svg {...base} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <rect x="3" y="4" width="18" height="16" rx="3.5" /><circle cx="9" cy="10" r="1.6" /><path d="m4 18 5-5 4 4 2.5-2.5L20 19" />
  </svg>
);
export const SparkleIcon = (p) => (
  <svg {...base} fill="currentColor" {...p}><path d="m12 2 2.3 6.2L20.5 10.5l-6.2 2.3L12 19l-2.3-6.2L3.5 10.5l6.2-2.3zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" /></svg>
);
export const PlusIcon = (p) => (
  <svg {...base} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" {...p}><path d="M12 5v14M5 12h14" /></svg>
);
export const MinusCircle = (p) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="10" fill="#ff3b30" /><path d="M7 12h10" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" /></svg>
);
export const PlusCircle = (p) => (
  <svg {...base} {...p}><circle cx="12" cy="12" r="10" fill="#34c759" /><path d="M12 7v10M7 12h10" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" /></svg>
);
export const DownloadIcon = (p) => (
  <svg {...base} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" /></svg>
);
export const LockIcon = (p) => (
  <svg {...base} fill="currentColor" {...p}><path d="M7 10V7.5a5 5 0 0 1 10 0V10h.5A2.5 2.5 0 0 1 20 12.5v6a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5v-6A2.5 2.5 0 0 1 6.5 10zm2 0h6V7.5a3 3 0 0 0-6 0z" /></svg>
);
export const ShieldIcon = (p) => (
  <svg {...base} fill="currentColor" {...p}><path d="M12 2.5 4.5 5.5v6c0 4.5 3 8.3 7.5 10 4.5-1.7 7.5-5.5 7.5-10v-6z" /></svg>
);
