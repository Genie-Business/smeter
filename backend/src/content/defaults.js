// Default copy for the website and the mobile app. The admin dashboard edits
// overrides on top of these (stored in the `content` table); public readers get
// defaults deep-merged with the saved overrides. The website's HTML ships the
// same text so pages render (and index) without the API.

export const SITE_DEFAULTS = {
  brand: {
    name: 'smeter',
    tagline: 'Smart prepaid metering',
  },
  contact: {
    tenantLine: '+234 800 000 0001',
    ownerLine: '+234 800 000 0002',
    email: 'hello@smeter.ng',
    whatsapp: '+234 800 000 0001',
    address: 'Lagos, Nigeria',
  },
  download: {
    androidUrl: '',
    iosUrl: '',
    comingSoonTitle: 'The app is almost here',
    comingSoonBody: 'Leave your number or email and we’ll send you the download link the day smeter goes live in the stores.',
  },
  images: {
    tenant: 'assets/img/tenant-phone.webp',
    owner: 'assets/img/landlord.webp',
    family: 'assets/img/family.webp',
    installer: 'assets/img/installer.webp',
    keypad: 'assets/img/keypad.webp',
    city: 'assets/img/lagos-dusk.webp',
    renderHero: 'assets/img/render-hero.webp',
    renderMacro: 'assets/img/render-macro.webp',
    renderHallway: 'assets/img/render-hallway.webp',
    device: 'assets/img/deck-meter-remote-white.webp',
  },
  home: {
    headline: ['Buy power', 'from your', 'phone in', 'seconds'],
    body: 'smeter is the smart prepaid meter and app for Nigerian homes. Tenants top up by card, transfer or USSD in seconds, and property owners get paid straight to their bank. **No queues and no estimated bills.**',
    primaryCta: 'Get the app',
    secondaryCta: 'For property owners',
    tiles: [
      { kind: 'stat', value: '24/7', label: 'Top up any time' },
      { kind: 'stat', value: '₦0', label: 'Estimated bills' },
      { kind: 'stat', value: '<15s', label: 'Payment to meter' },
    ],
    // Sections below the first screen. Tenant/owner points, load modes and the
    // problem stats are shared with the Product and Company pages.
    promise: ['One meter', 'per home.', 'Pay for what', 'you use.'],
    promiseBody: 'Every apartment gets its own smart prepaid meter. Tenants pay for exactly what they use, from their phone, and property owners see every naira land in their bank.',
    stepsTitle: 'How it works',
    steps: [
      { title: 'Get the app', body: 'Download smeter and sign in with the number printed on your meter.' },
      { title: 'Pick an amount', body: 'See the price per unit and a clear breakdown before you pay.' },
      { title: 'Pay your way', body: 'Card, bank transfer or USSD through a secure checkout.' },
      { title: 'Lights on', body: 'Units go straight to your meter, or you key a 20-digit token into the remote.' },
    ],
    tenantTitle: 'Made for tenants',
    tenantBody: 'Top up at midnight, see where your power goes, and keep every token and receipt in your pocket.',
    ownerTitle: 'Built for property owners',
    ownerBody: 'Set your unit price, get paid automatically and manage every apartment from one screen.',
    ownerCta: 'Book a free site survey',
    renderCaption: 'The smeter meter, the in-home keypad and the app.',
    modesTitle: 'Works with or without signal',
    whyTitle: 'Why it matters',
    whyBody: 'Millions of Nigerian homes still pay estimated bills. smeter gives every home a meter and a fair price.',
    faqTitle: 'Good to know',
    faqs: [
      { q: 'Is the app free?', a: 'Yes. smeter is free to download for tenants and property owners. You only pay for the power you buy.' },
      { q: 'Do I need internet to load units?', a: 'No. Buying needs a connection; loading a token on a manual-token meter doesn’t. Just type it into the in-home keypad.' },
      { q: 'How do I pay?', a: 'Card, bank transfer or USSD, through a secure checkout. We never see or store your card details.' },
      { q: 'I own a building. How do I start?', a: 'Book a free site survey. We check the wiring, install a meter in each unit and get you set up in the app.' },
      { q: 'What if something goes wrong?', a: 'Tap Help in the app to report a payment or meter issue, or call us. Every ticket gets a reference and goes to the right team.' },
    ],
    ctaLines: ['Power in', 'your pocket'],
  },
  product: {
    eyebrow: 'The product',
    headline: ['One meter.', 'One app.', 'Total control.'],
    intro: 'A screenless-friendly smart prepaid meter, an in-home keypad, and an app that does the rest. Buy units, see where your power goes, and never queue for a token again.',
    tenantTitle: 'For tenants',
    tenantPoints: [
      { title: 'Buy power in seconds', body: 'Pay by card, bank transfer or USSD. Units load on your meter automatically, or you get a token to key into the remote.' },
      { title: 'See your usage', body: 'Daily, weekly and monthly kWh and spend, so you know exactly where your money goes.' },
      { title: 'Every receipt, every token', body: 'Your purchase history and tokens live in the app. Copy, share or re-enter any of them.' },
      { title: 'Know your price', body: 'The price per unit is shown before you pay, with a clear breakdown of every naira.' },
    ],
    ownerTitle: 'For property owners',
    ownerPoints: [
      { title: 'Set your own unit price', body: 'Price per kWh for every meter, within regulated limits. Change it any time and tenants see it instantly.' },
      { title: 'Paid straight to your bank', body: 'Tenant payments settle automatically to your verified account. No cash, no chasing.' },
      { title: 'Recover old debts fairly', body: 'Take an agreed percentage of each purchase until an outstanding balance is cleared.' },
      { title: 'Every meter on one screen', body: 'See each apartment’s meter, tenant and payments, and get alerts when something needs you.' },
    ],
    modesTitle: 'Two ways to load units',
    modes: [
      { title: 'Automatic (GPRS)', body: 'Units are sent to the meter over the network seconds after payment. Includes live readings and usage analytics.' },
      { title: 'Manual token', body: 'No network link needed. Pay in the app, get a 20-digit token, and key it into the in-home remote. Works anywhere.' },
    ],
    specsTitle: 'Built for Nigerian power',
    specs: [
      { label: 'Phases', value: 'Single & three-phase' },
      { label: 'Standard', value: 'STS-compliant tokens' },
      { label: 'Protection', value: 'IP54 enclosure' },
      { label: 'Interface', value: 'In-home keypad (CIU)' },
      { label: 'Comms', value: 'GPRS / DLMS' },
      { label: 'Accuracy', value: 'IEC 62053-21 Class 1' },
    ],
    stepsTitle: 'Live in three steps',
    steps: [
      { title: 'We install', body: 'Our team fits and tests your smeter meter on site.' },
      { title: 'Link the app', body: 'Download smeter and sign in with your meter number.' },
      { title: 'Top up & track', body: 'Buy power and watch every unit from your phone.' },
    ],
    faqs: [
      { q: 'Do I need internet to load units?', a: 'No. If your meter is on manual-token mode, you just type the token into the in-home keypad. Buying the token needs a connection; loading it doesn’t.' },
      { q: 'What if the token doesn’t load?', a: 'Check the 20 digits and try again. Each token works once, on your meter only. Still stuck? Tap Help in the app and we’ll sort it out.' },
      { q: 'How do I pay?', a: 'Card, bank transfer or USSD, all through a secure checkout. We never see or store your card details.' },
      { q: 'Who sets the price per unit?', a: 'Your property owner sets it, within the regulated maximum. You always see it before you pay.' },
    ],
  },
  company: {
    eyebrow: 'The company',
    headline: ['Power billing', 'should be', 'fair & simple'],
    intro: 'We started smeter because buying electricity in Nigeria is still guesswork. Millions of homes pay estimated bills, queue for tokens, and argue over shared meters. We think every home deserves to pay for exactly what it uses, right from a phone.',
    problemTitle: 'The problem we’re solving',
    problems: [
      { value: '4.85M', label: 'electricity customers still have no meter, so they pay estimated bills.' },
      { value: '61.5%', label: 'national metering rate, so over a third of customers are still unmetered.' },
    ],
    problemSource: 'Source: NERC Q2 2026 metering data, reported September 2026.',
    missionTitle: 'Our mission',
    mission: 'Turn the “dumb” utility meter into a transparent, revenue-optimising digital asset for every African home and business.',
    values: [
      { title: 'Transparency', body: 'Every naira and every kilowatt-hour is visible to the people paying for it.' },
      { title: 'Reliability', body: 'Hardware with fewer failure points, and a token you can always load, online or off.' },
      { title: 'Fairness', body: 'Owners get paid on time; tenants pay for what they actually use.' },
    ],
    contactTitle: 'Talk to us',
  },
  owners: {
    eyebrow: 'Property owners',
    headline: ['Get paid', 'for power,', 'without chasing', 'tenants'],
    intro: 'smeter fits a smart prepaid meter in each apartment and gives you one app to price units, collect payments and see every meter. Tenants pay before they use. You get paid automatically.',
    benefits: [
      { value: '100%', label: 'Prepaid, so debts never pile up' },
      { value: 'Auto', label: 'Payments settle to your bank' },
      { value: '1 app', label: 'Every apartment, one screen' },
    ],
    stepsTitle: 'How onboarding works',
    steps: [
      { title: 'Book a free site survey', body: 'Tell us about your property. We visit, check the wiring and recommend the right meters.' },
      { title: 'We install and test', body: 'Our engineers fit a smeter meter in each unit and register it to your account.' },
      { title: 'Set your price and bank', body: 'In the app, set your price per unit and verify the bank account payments should settle into.' },
      { title: 'Invite your tenants', body: 'Add each tenant’s phone number. They sign in with their meter number and start buying power.' },
    ],
    formTitle: 'Book your free site survey',
    formBody: 'Leave your details and our team will call you within one working day.',
    formSuccess: 'Thanks, we’ve got your details. Our team will call you within one working day. In the meantime, download the app to look around.',
    faqs: [
      { q: 'What does it cost?', a: 'The survey is free. Meter pricing depends on the number of units and phase type. We’ll quote after the survey. There’s no monthly software fee.' },
      { q: 'How do I earn from it?', a: 'You set the price per kWh. The difference between the utility cost and your price is your margin, settled to your bank with every purchase.' },
      { q: 'What if a tenant owes me money?', a: 'Set a debt and a percentage. A share of each of their purchases goes to you until it’s cleared.' },
      { q: 'Do my meters need GPRS?', a: 'No. GPRS meters receive units automatically and give live data; manual-token meters work anywhere because tenants key the token into the keypad.' },
    ],
  },
  footer: {
    note: 'smeter. Smart prepaid metering for African homes.',
  },
};

export const APP_DEFAULTS = {
  onboarding: [
    { title: 'Welcome to smeter.', caption: 'Your home’s energy, now in your hands.' },
    { title: 'View My Bill', caption: 'See what you use and what you spend, day by day, with no meter keypad needed.' },
    { title: 'Property Owners', caption: 'Manage your tenant(s) electricity payments all from one screen' },
    { title: 'All Energy Sources', caption: 'One meter, One App to manage them all' },
    { title: 'Manage Your Power', caption: 'Solar or Grid or Generator power, you’ll always know exactly what’s happening' },
  ],
  announcement: {
    enabled: false,
    tone: 'info',
    title: '',
    body: '',
    audience: 'all', // all | tenants | owners
  },
  support: {
    phone: '+234 800 000 0001',
    email: 'support@smeter.ng',
    whatsapp: '+234 800 000 0001',
  },
  buy: {
    presets: [1000, 2000, 3000, 5000, 10000, 20000],
  },
  tokenHelp: [
    { title: 'Wake the remote', body: 'Press any key on your meter remote (the keypad unit inside your home).' },
    { title: 'Type the 20 digits', body: 'Enter the token exactly as shown. The groups of four make it easier to check.' },
    { title: 'Press Enter', body: 'Press the Enter (or #) key. The remote shows “Accept” and your units are added.' },
  ],
};

export const CONTENT_DEFAULTS = { site: SITE_DEFAULTS, app: APP_DEFAULTS };
