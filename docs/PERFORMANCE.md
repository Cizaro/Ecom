# Performance record

What has been measured, how, and what has not. Updated when the storefront changes materially.

## Budgets enforced by tests

`e2e/performance.spec.ts` runs on the phone profile against the production build and fails if a page goes over these. They are the parts of performance that do not depend on how fast the test computer is.

| Measure | Budget | Why |
| --- | --- | --- |
| Script sent per page view (compressed) | 200 KB | Script is the main cost on a mid-range phone |
| Styles sent (compressed) | 20 KB | |
| Page HTML (compressed) | 150 KB | Generous: the test store's navigation grows with every local test run |
| Cumulative Layout Shift | 0.1 | Under 0.1 is "good" by the Core Web Vitals definition |
| Pictures without a declared size | 0 | A picture that declares its size cannot make the page jump |

## Measurements

2026-11-14, Milestone 2.6, production build, local test server, phone-sized screen (Pixel 7 profile), no network or processor throttling.

| Page | Script | Styles | HTML | Layout shift |
| --- | --- | --- | --- | --- |
| Home (`/`) | 140.1 KB | 5.3 KB | 33.1 KB | 0 |
| All products (`/products`) | 141.7 KB | 5.3 KB | 32.8 KB | 0 |

The HTML figure is inflated by the test store, which had about sixty categories in its navigation from earlier test runs. A store with a handful of categories sends far less.

## What is in place

- Product pictures are resized by the worker to 320, 640 and 1280 pixels wide (WebP) and offered through `srcset`, so a phone downloads a small version.
- Pictures below the first screen load when scrolled to; the first row loads at once.
- Every picture declares its width and height.
- Files in storage are served with a one-year, immutable cache lifetime (each upload gets a new address).
- The storefront works without JavaScript; script adds conveniences (instant sort, gallery thumbnails) on top.

## Not measured yet

- **Timings** (Largest Contentful Paint, Time to First Byte, Interaction to Next Paint). They depend on the hosting, the network and the device, so numbers from a development computer would mislead. Measure on the deployed site with throttling, and from real visitors once there are some.
- **Picture download size.** Pictures come from the storage address, and the browser does not report sizes across addresses without an extra header from the storage service.
- **Load under traffic.** Every page is rendered on request today (decision in ARCHITECTURE.md); caching of the home and category pages is a listed follow-up.
