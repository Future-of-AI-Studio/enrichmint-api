/**
 * Demo content. Every person and guide here is FICTIONAL and is shown with a
 * "Demo profile" label. Replace Maria's guide with a consenting real
 * contributor's experience when one is available.
 */
export const CATEGORIES = [
  {
    slug: 'work-transitions',
    name: 'Work transitions',
    description: 'Changing roles, careers or ways of working.',
  },
  {
    slug: 'freelancing',
    name: 'Freelancing and clients',
    description: 'Finding clients, pricing and managing scope.',
  },
  {
    slug: 'starting-a-business',
    name: 'Starting a business',
    description: 'First steps, money and early mistakes.',
  },
  {
    slug: 'caregiving',
    name: 'Caregiving',
    description: 'Caring for family while keeping life running.',
  },
  {
    slug: 'moving-abroad',
    name: 'Moving abroad',
    description: 'Visas, settling in and finding work in a new country.',
  },
  {
    slug: 'learning-a-craft',
    name: 'Learning a craft',
    description: 'Getting good at a practical skill as an adult.',
  },
];

export interface DemoGuide {
  slug: string;
  category: string;
  title: string;
  priceCents: number;
  agentAssistAllowed: boolean;
  topics: string[];
  summary: string;
  preview: string;
  sections: Record<string, string>;
}

export interface DemoContributor {
  key: string;
  email: string;
  displayName: string;
  headline: string;
  background: string;
  responsePriceCents: number | null;
  acceptingRequests: boolean;
  guides: DemoGuide[];
}

export const MARIA: DemoContributor = {
  key: 'maria',
  email: 'maria@enrichmint.demo',
  displayName: 'Maria (demo)',
  headline:
    'Former customer support lead, now a freelance customer-onboarding consultant',
  background:
    'I spent six years in customer support at a software company, the last two as a team lead. When our team was reorganized around AI tools, I moved into freelance onboarding work for small software companies.',
  responsePriceCents: 1500,
  acceptingRequests: true,
  guides: [
    {
      slug: 'from-support-to-freelance-onboarding',
      category: 'work-transitions',
      title:
        'From support lead to freelance onboarding consultant: how I found my first client',
      priceCents: 500,
      agentAssistAllowed: true,
      topics: [
        'freelancing',
        'customer support',
        'first client',
        'career change',
        'onboarding',
      ],
      summary:
        'How I turned support experience into a freelance onboarding service, found my first paying client through my existing network, and what I got wrong in the first three months.',
      preview:
        'Covers how I worked out what part of my support job people would pay for, the exact outreach I used to land a first client, the mistakes I made with scope, and when this path is probably not right for you.',
      sections: {
        background:
          'I worked in customer support for six years, the last two leading a team of eight. A lot of my time went into onboarding new customers: setup calls, help articles and the first-month check-ins.',
        starting_point:
          'When our team was reorganized around AI chat tools, my role shrank to reviewing escalations. I had no freelance experience, no portfolio and only weekends free because I kept my job while testing the idea.',
        actions:
          'I listed the parts of my job that customers thanked us for, and onboarding came out on top. I wrote a one-page offer: "I set up your customer onboarding emails and help docs in two weeks." Then I messaged former colleagues who had moved to small software companies. I sent twelve messages over two weekends. Two people replied, and one became my first client after a 20-minute call. I chose my network over job platforms because people who already trusted my work did not need a portfolio from me.',
        mistakes:
          'I agreed to "help with onboarding" without writing down what that meant, and the first project grew from emails and docs into running their support inbox. I also said yes to a call at 7am on a weekday, which my day job could not support. After that I always wrote a short scope list and the hours I am available before starting.',
        outcomes:
          'Self-reported: my first client paid for a two-week project and referred me to a second company a month later. Within three months I had enough regular work to reduce my day job hours. This is my experience only; it is not typical or guaranteed.',
        takeaways:
          'Start from what customers already thanked you for. Ask people who know your work before strangers. Write the scope in one short list and send it before you start. Decide your available hours first and say them up front.',
        audience:
          'People in customer support or similar roles who want to test freelancing on weekends without quitting, and who have a network of former colleagues.',
        limitations:
          'This worked because I had a network at small software companies. If you do not have that, the outreach part will be slower. I do not cover pricing in detail here: I charged a flat project fee my first client suggested, and I would not repeat that. It is also not legal or tax advice.',
      },
    },
  ],
};

export const OTHER_CONTRIBUTORS: DemoContributor[] = [
  {
    key: 'sam',
    email: 'sam@enrichmint.demo',
    displayName: 'Sam (demo)',
    headline:
      'Moved from retail management to a part-time bookkeeping practice',
    background:
      'I managed a retail store for nine years before retraining as a bookkeeper in evenings.',
    responsePriceCents: null,
    acceptingRequests: false,
    guides: [
      {
        slug: 'retraining-in-the-evenings',
        category: 'work-transitions',
        title: 'Retraining in the evenings while working full time',
        priceCents: 800,
        agentAssistAllowed: false,
        topics: [
          'retraining',
          'career change',
          'time management',
          'bookkeeping',
        ],
        summary:
          'How I fitted a year of evening study around a full-time job, and the routine that kept me going.',
        preview:
          'My weekly routine, how I chose a course, what I dropped to make time, and the month I nearly quit.',
        sections: {
          background:
            'Nine years as a retail store manager, then a year of evening study to become a bookkeeper.',
          starting_point:
            'Full-time job, two kids, no accounting background, about six free hours a week.',
          actions:
            'I picked a course with recorded lessons so I could study after 9pm, and blocked two evenings plus Saturday morning.',
          mistakes:
            'I tried to study every night at first and burned out in the third week.',
          outcomes:
            'Self-reported: I finished the course in eleven months and took on three small clients.',
          takeaways:
            'Plan for fewer hours than you think you have. Protect one full night off.',
          audience:
            'People retraining for a new field while keeping a full-time job.',
          limitations:
            'My employer was flexible about shifts. Without that it would have taken longer.',
        },
      },
    ],
  },
  {
    key: 'priya',
    email: 'priya@enrichmint.demo',
    displayName: 'Priya (demo)',
    headline:
      'Freelance designer for eight years, now mentoring new freelancers',
    background:
      'I have run a freelance design practice for eight years and have priced hundreds of projects.',
    responsePriceCents: 2500,
    acceptingRequests: true,
    guides: [
      {
        slug: 'pricing-your-first-freelance-projects',
        category: 'freelancing',
        title: 'Pricing your first freelance projects without underselling',
        priceCents: 2500,
        agentAssistAllowed: true,
        topics: ['freelancing', 'pricing', 'clients', 'scope'],
        summary:
          'How I moved from hourly rates to project pricing, and the three questions I ask before quoting.',
        preview:
          'The three questions I ask before every quote, how I set a floor price, and how I handled my first price increase.',
        sections: {
          background: 'Eight years as a freelance designer.',
          starting_point:
            'I started at an hourly rate a friend suggested and was always busy but never comfortable.',
          actions:
            'I started asking what the project was worth to the client, how fast they needed it, and what happens if it is not done.',
          mistakes:
            'I quoted on calls before thinking, and regretted it most times.',
          outcomes:
            'Self-reported: my income became steadier once I quoted by project.',
          takeaways:
            'Never quote on the first call. Write a floor price before every quote.',
          audience: 'New freelancers in creative or service work.',
          limitations:
            'My clients were mostly small businesses in one country. Rates differ a lot by market.',
        },
      },
    ],
  },
  {
    key: 'tomas',
    email: 'tomas@enrichmint.demo',
    displayName: 'Tomas (demo)',
    headline: 'Cared for a parent while keeping a small business running',
    background:
      'I looked after my father for two years while running a two-person print shop.',
    responsePriceCents: null,
    acceptingRequests: false,
    guides: [
      {
        slug: 'caregiving-and-running-a-small-business',
        category: 'caregiving',
        title: 'Caring for a parent while running a small business',
        priceCents: 600,
        agentAssistAllowed: true,
        topics: ['caregiving', 'small business', 'family', 'routine'],
        summary:
          'What I delegated, what I stopped doing, and how I talked to customers about slower turnaround.',
        preview:
          'The weekly plan my sister and I used, the work I handed to my employee, and what I wish I had asked for sooner.',
        sections: {
          background: 'I run a small print shop with one employee.',
          starting_point:
            'My father needed daily help after a fall. I had no plan and no backup.',
          actions:
            'My sister and I split days, and I trained my employee to handle quotes.',
          mistakes:
            'I hid the situation from customers for months and missed deadlines without explaining.',
          outcomes:
            'Self-reported: the business stayed open and most customers were understanding once I told them.',
          takeaways:
            'Tell regular customers early. Write down what only you can do, and train someone on the rest.',
          audience:
            'Small business owners suddenly caring for a family member.',
          limitations:
            'I had family nearby to share care. This is not medical or legal advice.',
        },
      },
    ],
  },
];

export const ALEX = {
  email: 'alex@enrichmint.demo',
  displayName: 'Alex (demo)',
};
