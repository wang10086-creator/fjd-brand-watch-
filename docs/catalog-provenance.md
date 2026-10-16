# Catalog provenance · 2026-10-16

## Geography
`world-markets.js` includes 249 ISO 3166 countries / territories and XK (250
entries), derived from https://github.com/mledoze/countries (Open Database
License / Database Contents License). Country display names use Intl.DisplayNames;
existing application names and market IDs remain stable. Linguistic presence is
not a statement that a platform operates, ships, or holds registrations there.
Queries include verified platform languages, territory languages and English.
For languages without reviewed intent translations, the query uses the original
brand wordmark and language hint, explicitly marked `brand-only`; English queries
remain in the plan. Identical actual queries are sent once with their associated
market/language lists preserved.

## Platform directory
169 platform families were added to the existing 104 (273 total). Each new entry
contains an official source URL and explicit market/domain mapping. Platforms are
queried through public search indexes; no native API connection is claimed. A
source-domain probe returned HTTP 200 for 123 of the 169 primary URLs; other
responses included access restrictions, network errors, limits and redirects.
This is a catalog validation, not proof of search coverage or original-page
access. Runtime states are determined only by actual monitored queries.
Additional discovery references:
- https://www.shopbycountries.com/en
- https://www.webretailer.com/marketplaces-worldwide/online-marketplaces/
- https://www.scottish-enterprise.com/how-we-can-help/exports-and-international-markets/international-ecommerce/international-online-marketplaces
This is an expandable directory, not an exhaustive inventory of all websites.

## Supplied registration inventory
`商标清单总表.xlsx`, supplied 2026-10-16, contains 748 nonblank description
rows in three visible sheets. Existing 70 entry IDs and original image assets are
retained; they are presented in 61 families. Registration references retain the
source sheet, A/C cell addresses, original description and jurisdiction string.
There are no registration numbers, Nice classes, owners, validity dates or legal
status fields. Do not label these rows as registry-verified rights.
Two ambiguous values `马德里—R` (C131 and C157 in 马德里商标) remain unmapped.
EU = 27 current member markets, BX = Belgium/Netherlands/Luxembourg,
OAPI = 17 member markets, as jurisdiction lookup aids only; Madrid designation
does not establish grant. Source workbook SHA-256 is in `registrationInventory`.
Reimport: `python3 scripts/import-registration-inventory.py /path/to/file.xlsx`
from the repository root (requires openpyxl); inspect unmatched rows before use.
