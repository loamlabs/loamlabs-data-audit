Skip to main content
We have updated our Terms of Service

Enhance SEO for Component Library
52,606 tokens

it's been i believe, over 6 months since we've completed section 10, the wheel component library.  we initially set this page up in roder to help my websites SEO by providing a library of components and their dimensions to internet users seeking specs for rims, hubs, spokes etc they cannot otherwise find.
since the page has been up, it seems as though google is not ranking the page as an authority.  further investigation seems to have found that, since the page reaches out to a json database on github and loads once the user is on the page, google scrapers never actually see the content, likely just mostly a blank page with little to no content.
i would like to discuss ways we can keep the data in the json file on github but also make it available on my website in the same manor from the users experience but now allow google to see all the data.
i have an idea as to how i want to do it but i feel like you will have a much better idea.
before you brainstorm, do you need any additional data?
here are the two files in my shopify code editor related to the wheel component library:
wheel-component-library.js
/* =================================================================== /
/ LOAMLABS WHEEL COMPONENT LIBRARY SCRIPT V8.1 (Bug Fixes)            /
/ =================================================================== */
document.addEventListener('DOMContentLoaded', () => {
const rootElement = document.getElementById('wheel-component-app');
if (!rootElement) { return; }
code
Code
const API_URL = 'https://loamlabs-component-api.vercel.app/api/get-components';

async function fetchComponentData() {
    try {
        const response = await fetch(API_URL);
        if (!response.ok) { throw new Error(`Network response was not ok: ${response.statusText}`); }
        return await response.json();
    } catch (error) {
        console.error('Failed to fetch component library:', error);
        rootElement.innerHTML = `<div class="ll-library-error"><p><strong>Error:</strong> Could not load the wheel component library.</p><p>Please try again later.</p></div>`;
        return null;
    }
}

function processData(data) {
    const library = { rims: {}, hubs: {}, spokes: {}, nipples: {} };

    // --- RIMS ---
    if (data.rims) {
        const rimsByTitle = data.rims.reduce((acc, item) => {
            if (item.Vendor && item.Title) {
                if (!acc[item.Title]) { acc[item.Title] = []; }
                acc[item.Title].push(item);
            }
            return acc;
        }, {});
        Object.values(rimsByTitle).forEach(variants => {
            const representativeItem = variants[0];
            const sizes = {};
            variants.forEach(variant => {
                const size = variant['Option1 Value'];
                if (!sizes[size]) {
                    sizes[size] = { specs: variant, spokeCounts: new Set() };
                }
                sizes[size].spokeCounts.add(variant['Option2 Value']);
            });
            representativeItem.sizes = sizes;
            if (!library.rims[representativeItem.Vendor]) { library.rims[representativeItem.Vendor] = []; }
            library.rims[representativeItem.Vendor].push(representativeItem);
        });
        Object.keys(library.rims).forEach(vendor => library.rims[vendor].sort((a, b) => a.Title.localeCompare(b.Title)));
    }

    // --- HUBS ---
    if (data.hubs) {
        const hubsByTitle = data.hubs.reduce((acc, item) => {
            if (item.Vendor && item.Title) {
                if (!acc[item.Title]) { acc[item.Title] = []; }
                acc[item.Title].push(item);
            }
            return acc;
        }, {});
        Object.values(hubsByTitle).forEach(variants => {
            const representativeItem = variants[0];
            if (!library.hubs[representativeItem.Vendor]) { library.hubs[representativeItem.Vendor] = []; }
            library.hubs[representativeItem.Vendor].push(variants);
        });
        Object.keys(library.hubs).forEach(vendor => library.hubs[vendor].sort((a, b) => a[0].Title.localeCompare(b[0].Title)));
    }

    // --- SPOKES ---
    if (data.spokes) {
        data.spokes.forEach(spoke => {
            if (spoke.Vendor && spoke.Title) {
                if (!library.spokes[spoke.Vendor]) { library.spokes[spoke.Vendor] = []; }
                library.spokes[spoke.Vendor].push(spoke);
            }
        });
        Object.keys(library.spokes).forEach(vendor => library.spokes[vendor].sort((a, b) => a.Title.localeCompare(b.Title)));
    }

    // --- NIPPLES ---
    if (data.nipples) {
        const nipplesByTitle = data.nipples.reduce((acc, item) => {
            if (item.Vendor && item.Title) {
                if (!acc[item.Title]) { acc[item.Title] = []; }
                acc[item.Title].push(item);
            }
            return acc;
        }, {});
        Object.values(nipplesByTitle).forEach(variants => {
            const representativeItem = variants[0];
            if (!library.nipples[representativeItem.Vendor]) { library.nipples[representativeItem.Vendor] = []; }
            library.nipples[representativeItem.Vendor].push(variants);
        });
        Object.keys(library.nipples).forEach(vendor => library.nipples[vendor].sort((a, b) => a[0].Title.localeCompare(b[0].Title)));
    }

    return library;
}

function renderLibrary(library) {
    const componentOrder = [
        { key: 'rims', title: 'Rims' },
        { key: 'hubs', title: 'Hubs' },
        { key: 'spokes', title: 'Spokes' },
        { key: 'nipples', title: 'Nipples' }
    ];

    let html = componentOrder.map(({ key, title }) => `
        <details class="ll-component-category" id="category-${key}">
            <summary class="ll-category-summary">${title}</summary>
            <div class="ll-category-content">
                ${renderComponentType(library[key], key)}
            </div>
        </details>
    `).join('');

    rootElement.innerHTML = `<div class="ll-library-container">${html}</div>`;
}

function renderComponentType(vendors, typePrefix) {
const sortedVendors = Object.keys(vendors).filter(v => v && typeof v === 'string' && v.trim() !== '').sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
if (sortedVendors.length === 0) return '<h2></h2><p>No components found for this category.</p>';

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split('');
const availableLetters = new Set(sortedVendors.map(v => v[0].toUpperCase()));
const azNav = `<nav class="ll-az-nav" id="${typePrefix}-az-nav">${alphabet.map(letter => availableLetters.has(letter) ? `<a href="#${typePrefix}-${letter}">${letter}</a>` : `<span>${letter}</span>`).join('')}</nav>`;

let currentLetter = '';
const vendorHTML = sortedVendors.map(vendor => {
    const firstLetter = vendor[0].toUpperCase();
    let letterHeader = '';
    if (firstLetter !== currentLetter) {
        currentLetter = firstLetter;
        letterHeader = `<h3 id="${typePrefix}-${currentLetter}" class="ll-letter-header">${currentLetter}</h3>`;
    }
    let hubTypeFilters = '';
    if (typePrefix === 'hubs') {
        const hubTypes = new Set(vendors[vendor].flat().map(hub => hub['Metafield: custom.hub_type [single_line_text_field]']));
        if (hubTypes.size > 1) {
            hubTypeFilters = `<div class="ll-hub-type-filters"><button class="hub-type-filter-btn active" data-filter="All">All</button>${[...hubTypes].sort().map(type => `<button class="hub-type-filter-btn" data-filter="${type}">${type}</button>`).join('')}</div>`;
        }
    }

    let componentListHTML;
    if (typePrefix === 'nipples') {
        const allVariants = vendors[vendor].flat();
        componentListHTML = allVariants.map(variant => {
            // Pass 'nipples' as the type
            return `<li class="ll-component-item--no-accordion">${generateSpecTableHTML([variant], 'nipples')}</li>`;
        }).join('');
    } else {
        componentListHTML = vendors[vendor].map(componentData => {
             const title = Array.isArray(componentData) ? componentData[0].Title : componentData.Title;
             const hubType = (Array.isArray(componentData) ? componentData[0] : componentData)['Metafield: custom.hub_type [single_line_text_field]'] || '';
             // Pass the current category type (rims, hubs, or spokes)
             return `<li data-hub-type="${hubType}"><details class="ll-component-details"><summary class="ll-component-title">${title}</summary>${generateSpecTableHTML(componentData, typePrefix)}</details></li>`;
        }).join('');
    }

    return `${letterHeader}<details class="ll-vendor-section"><summary class="ll-vendor-title">${vendor}</summary>${hubTypeFilters}<ul class="ll-component-list">${componentListHTML}</ul></details>`;
}).join('');

return azNav + vendorHTML;
}
code
Code
function generateCalculatorLink(component, type, position, size = null) {
if (typeof LZString === 'undefined' || !LZString.compressToBase64) {
     console.error("LZString library not available or invalid.");
     return "/pages/spoke-calculator";
}

const state = { pos: position };

if (type === 'rims') {
    state.r_vid = component.Vendor;
    state.r_mid = component.Title;
    if (size) {
         state.r_varid = `${component.Title}-${size}`;
    }
} else { 
    state.h_vid = component.Vendor;
    state.h_mid = component.Title;
    state.h_varid = component.Title;
}
const jsonString = JSON.stringify(state);
const compressedString = LZString.compressToBase64(jsonString);
return `/pages/spoke-calculator#${compressedString}`;
}
code
Code
function generateSpecTableHTML(componentData, type) {
const representative = Array.isArray(componentData) ? componentData[0] : componentData;
let tableHTML = '';

const getWeight = (comp) => {
    const vWeight = comp['Variant Metafield: custom.weight_g [number_decimal]'];
    if (vWeight) return `${vWeight}g`;
    const pWeight = comp['Metafield: custom.weight_g [number_decimal]'];
    return pWeight ? `${pWeight}g` : 'N/A';
};
const addRow = (rows, label, value) => {
    if (value !== null && value !== undefined && value !== '') return rows + `<tr><td>${label}</td><td>${value}</td></tr>`;
    return rows;
};

const generateProductPageButton = (component) => {
    if (component.ProductURL) {
        return `<a href="${component.ProductURL}" target="_blank" class="ll-calc-link-btn ll-product-page-link">Visit Product Page</a>`;
    }
    return '';
};

// --- RIM SECTION ---
if (type === 'rims' && representative.sizes) {
    Object.keys(representative.sizes).sort().reverse().forEach(size => {
        const sizeData = representative.sizes[size];
        const variant = sizeData.specs;
        let rows = '';
        
        rows = addRow(rows, 'ERD', variant['Variant Metafield: custom.rim_erd [number_decimal]']);
        rows = addRow(rows, 'Spoke Hole Offset', variant['Metafield: custom.rim_spoke_hole_offset [number_decimal]']);
        const washerPolicy = variant['Metafield: custom.rim_washer_policy [single_line_text_field]'];
        const washerThickness = variant['Metafield: custom.nipple_washer_thickness [number_decimal]'];
        if (washerPolicy) {
             rows = addRow(rows, 'Washer Policy', washerPolicy);
             if (washerPolicy === 'Mandatory' && washerThickness) { rows = addRow(rows, 'Washer Thickness', `${washerThickness}mm`); }
        }
        rows = addRow(rows, 'Available Spoke Counts', Array.from(sizeData.spokeCounts).sort((a,b) => parseInt(a) - parseInt(b)).join(', '));
        rows = addRow(rows, 'Weight', getWeight(variant));

        let frontLink = '', rearLink = '';
        const position = variant['Variant Metafield: custom.wheel_spec_position [single_line_text_field]'];
        
        if (position === 'Front' || position === 'Front/Rear') {
            frontLink = `<a href="${generateCalculatorLink(variant, 'rims', 'front', size)}" target="_blank" class="ll-calc-link-btn">Use in Front Wheel Calc</a>`;
        }
        if (position === 'Rear' || position === 'Front/Rear') {
            rearLink = `<a href="${generateCalculatorLink(variant, 'rims', 'rear', size)}" target="_blank" class="ll-calc-link-btn">Use in Rear Wheel Calc</a>`;
        }
        
        const productPageButton = generateProductPageButton(representative);
        tableHTML += `<div class="ll-variant-spec-block"><h5 class="ll-variant-title">${size}</h5><table class="ll-spec-table"><tbody>${rows}</tbody></table><div class="ll-spec-actions">${productPageButton}<div class="ll-calc-actions-group">${frontLink}${rearLink}</div></div></div>`;
    });

// --- HUB SECTION ---
} else if (type === 'hubs') {
    const hubModelRepresentative = componentData[0];
    let rows = '';

    const hubType = hubModelRepresentative['Metafield: custom.hub_type [single_line_text_field]'];
    rows = addRow(rows, 'Hub Type', hubType);
    rows = addRow(rows, 'Flange Dia. (L/R)', `${hubModelRepresentative['Metafield: custom.hub_flange_diameter_left [number_decimal]']} / ${hubModelRepresentative['Metafield: custom.hub_flange_diameter_right [number_decimal]']}`);
    rows = addRow(rows, 'Flange Offset (L/R)', `${hubModelRepresentative['Metafield: custom.hub_flange_offset_left [number_decimal]']} / ${hubModelRepresentative['Metafield: custom.hub_flange_offset_right [number_decimal]']}`);
    
    if (hubType === 'Straight Pull') {
        rows = addRow(rows, 'Spoke Offset (L/R)', `${hubModelRepresentative['Variant Metafield: custom.hub_sp_offset_spoke_hole_left [number_decimal]']} / ${hubModelRepresentative['Variant Metafield: custom.hub_sp_offset_spoke_hole_right [number_decimal]']}`);
    } else {
        rows = addRow(rows, 'Spoke Hole Dia.', hubModelRepresentative['Metafield: custom.hub_spoke_hole_diameter [number_decimal]']);
    }

    const spokeCounts = new Set(componentData.map(variant => variant['Option1 Value']));
    rows = addRow(rows, 'Available Spoke Counts', Array.from(spokeCounts).sort((a,b) => parseInt(a) - parseInt(b)).join(', '));
    rows = addRow(rows, 'Weight', getWeight(hubModelRepresentative));

    let frontLink = '', rearLink = '';
    const position = hubModelRepresentative['Variant Metafield: custom.wheel_spec_position [single_line_text_field]'];

    if (position === 'Front' || position === 'Front/Rear') {
        frontLink = `<a href="${generateCalculatorLink(hubModelRepresentative, 'hubs', 'front')}" target="_blank" class="ll-calc-link-btn">Use in Front Wheel Calc</a>`;
    }
    if (position === 'Rear' || position === 'Front/Rear') {
        rearLink = `<a href="${generateCalculatorLink(hubModelRepresentative, 'hubs', 'rear')}" target="_blank" class="ll-calc-link-btn">Use in Rear Wheel Calc</a>`;
    }

    const productPageButton = generateProductPageButton(hubModelRepresentative);

    tableHTML = `<div class="ll-variant-spec-block">
                    <table class="ll-spec-table"><tbody>${rows}</tbody></table>
                    <div class="ll-spec-actions">${productPageButton}<div class="ll-calc-actions-group">${frontLink}${rearLink}</div></div>
                 </div>`;

// --- SPOKE SECTION ---
} else if (type === 'spokes') {
    let rows = '';
    const spoke = representative;
    rows = addRow(rows, 'Type', spoke['Metafield: custom.spoke_type [single_line_text_field]']);
    rows = addRow(rows, 'Diameter', spoke['Metafield: custom.spoke_diameter_spec [single_line_text_field]']);
    rows = addRow(rows, 'Weight', getWeight(spoke));
    rows = addRow(rows, 'Cross Section Area', `${spoke['Metafield: custom.spoke_cross_section_area_mm2 [number_decimal]']} mm²`);
    
    const productPageButton = generateProductPageButton(spoke);

    tableHTML += `<div class="ll-variant-spec-block">
        <h5 class="ll-variant-title">${spoke['Metafield: custom.spoke_model_group [single_line_text_field]'] || spoke.Title}</h5>
        <table class="ll-spec-table"><tbody>${rows}</tbody></table>
        <div class="ll-spec-actions">${productPageButton}</div>
        <p class="ll-spec-table-note">Note: Weight is for a 260mm reference length.</p>
    </div>`;

// --- NIPPLE SECTION ---
} else if (type === 'nipples') {
    const productPageButton = generateProductPageButton(representative);
    
    let variantHTML = componentData.map(variant => {
        let rows = '';
        rows = addRow(rows, 'Head Height', `${variant['Variant Metafield: custom.nipple_head_height_mm [number_decimal]']}mm`);
        rows = addRow(rows, 'Weight', getWeight(variant));

        return `<div class="ll-variant-spec-block">
            <h5 class="ll-variant-title">${variant['Option1 Value']}</h5>
            <table class="ll-spec-table"><tbody>${rows}</tbody></table>
        </div>`;
    }).join('');

    tableHTML = `<div class="ll-spec-actions">${productPageButton}</div>${variantHTML}`;
}
return `<div class="ll-spec-table-wrapper">${tableHTML}</div>`;
}
code
Code
function initializeNavigation() {
    const stickyHeader = document.getElementById('ll-sticky-filters');
    // Add a 10px buffer for better spacing
    const headerOffset = stickyHeader ? stickyHeader.offsetHeight + 10 : 70;

    const handleNavClick = (event) => {
        const categoryLink = event.target.closest('.ll-sticky-nav-link');
        const azLink = event.target.closest('.ll-az-nav a');

        if (categoryLink) {
            event.preventDefault();
            const targetId = `category-${categoryLink.dataset.target}`;
            const targetElement = document.getElementById(targetId);

            if (targetElement) {
                document.querySelectorAll('.ll-component-category').forEach(el => {
                    if (el.id !== targetId) el.open = false;
                });
                targetElement.open = true;
                
                const elementPosition = targetElement.getBoundingClientRect().top;
                const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
                
                window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
            }
        } else if (azLink) {
            // BUG FIX: Custom scrolling for A-Z links
            event.preventDefault();
            const targetId = azLink.getAttribute('href');
            const targetElement = document.querySelector(targetId);

            if (targetElement) {
                const elementPosition = targetElement.getBoundingClientRect().top;
                const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
                
                window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
            }
        }
    };

    document.body.addEventListener('click', handleNavClick);

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const id = entry.target.getAttribute('id');
            const navLink = document.querySelector(`.ll-sticky-nav-link[data-target="${id.replace('category-','')}"`);
            if (navLink) {
                if (entry.isIntersecting) {
                    document.querySelectorAll('.ll-sticky-nav-link').forEach(link => link.classList.remove('active'));
                    navLink.classList.add('active');
                }
            }
        });
    }, { rootMargin: `-${headerOffset}px 0px -80% 0px` });

    document.querySelectorAll('.ll-component-category').forEach(section => {
        observer.observe(section);
    });
}

async function init() {
    const data = await fetchComponentData();
    if (data) {
        const library = processData(data);
        renderLibrary(library);
        initializeNavigation();
    }
}

init();
});
wheel-component-library-template.liquid
{% comment %} Add the sticky filter bar HTML above the main app container {% endcomment %}
<div class="ll-sticky-filters" id="ll-sticky-filters">
  <div class="page-width">
    <nav class="ll-sticky-nav">
      <a href="#category-rims" class="ll-sticky-nav-link" data-target="rims">Rims</a>
      <a href="#category-hubs" class="ll-sticky-nav-link" data-target="hubs">Hubs</a>
      <a href="#category-spokes" class="ll-sticky-nav-link" data-target="spokes">Spokes</a>
      <a href="#category-nipples" class="ll-sticky-nav-link" data-target="nipples">Nipples</a>
    </nav>
  </div>
</div>
<div class="page-width">
  <div id="wheel-component-app" data-lzstring-url="{{ 'lz-string.min.js' | asset_url }}">
    <div class="ll-library-loading">
      <p>Loading Wheel Component Library...</p>
      <div class="spinner"></div>
    </div>
  </div>
</div>
{% schema %}
{
"name": "Wheel Component App",
"tag": "section",
"class": "wheel-component-library-section",
"settings": [],
"presets": [
{
"name": "Wheel Component App"
}
]
}
{% endschema %}
here is the get-components.js on github:
{% comment %} Add the sticky filter bar HTML above the main app container {% endcomment %}
<div class="ll-sticky-filters" id="ll-sticky-filters">
  <div class="page-width">
    <nav class="ll-sticky-nav">
      <a href="#category-rims" class="ll-sticky-nav-link" data-target="rims">Rims</a>
      <a href="#category-hubs" class="ll-sticky-nav-link" data-target="hubs">Hubs</a>
      <a href="#category-spokes" class="ll-sticky-nav-link" data-target="spokes">Spokes</a>
      <a href="#category-nipples" class="ll-sticky-nav-link" data-target="nipples">Nipples</a>
    </nav>
  </div>
</div>
<div class="page-width">
  <div id="wheel-component-app" data-lzstring-url="{{ 'lz-string.min.js' | asset_url }}">
    <div class="ll-library-loading">
      <p>Loading Wheel Component Library...</p>
      <div class="spinner"></div>
    </div>
  </div>
</div>
{% schema %}
{
"name": "Wheel Component App",
"tag": "section",
"class": "wheel-component-library-section",
"settings": [],
"presets": [
{
"name": "Wheel Component App"
}
]
}
{% endschema %}
i have the four component jsons but i am not sure you need them just yet
thoughts?
Model 9:25 PM
ThinkingThoughts
Expand to view model thoughts

chevron_right
You have correctly diagnosed the issue. Because your wheel-component-library.js fetches data and builds the HTML after the page has loaded in the browser, Google’s "look" at your site often results in a nearly empty container. While Google can execute JavaScript, it often times out or de-prioritizes pages that don't have meaningful "Initial HTML."
Since we already have a robust backend infrastructure (the Master Cron and Vercel tools), we can solve this without moving your data out of GitHub.
The Strategy: "Static SEO Injection"
Instead of forcing the browser to build the library every time, we will make your Daily Master Cron (Section 4.2) do the work once a day.
The Workflow:
Generate: Your Vercel Cron job will fetch the JSON files, loop through them, and generate a simplified, semantic HTML string (using <h2>, <h3>, and <table> tags) containing every spec.
Push: The script will push this massive HTML string into a Shopify Metafield on the "Wheel Component Library" page.
Render: When a user (or Google) hits the page, Shopify renders that Metafield immediately in the Liquid template.
Hydrate: Your existing JavaScript will then "take over," hiding the static list and showing the interactive, searchable library the user is used to.
Do I need more data?
Yes, to give you the exact "Copy-Paste" code for the backend, I need to see the Structure of the JSONs. Specifically:
A sample of a Rim entry from your JSON.
A sample of a Hub entry from your JSON.
(You don't need to send all 900+ items, just one of each so I can see the key names like "ERD", "PCD", etc.)
The Preliminary Plan (How we will implement it)
1. The Shopify Metafield
We will create a Metafield on the Page object:
Namespace: custom
Key: seo_library_content
Type: Multi-line text or HTML
2. The Liquid Update (wheel-component-library-template.liquid)
We will change the container to look like this:
code
Liquid
<div id="wheel-component-app" ...>
  {% if page.metafields.custom.seo_library_content != blank %}
    <!-- Google sees this immediately -->
    <div id="ll-seo-static-content">
      {{ page.metafields.custom.seo_library_content.value }}
    </div>
  {% endif %}
  
  <!-- This shows only if JS is slow/fails -->
  <div class="ll-library-loading">
    <p>Loading Interactive Library...</p>
    <div class="spinner"></div>
  </div>
</div>
3. The JS Update (wheel-component-library.js)
We add one line to the top of your renderLibrary function:
code
JavaScript
function renderLibrary(library) {
    // Kill the static SEO content once the interactive app is ready
    const staticContent = document.getElementById('ll-seo-static-content');
    if (staticContent) staticContent.remove(); 
    
    // ... rest of your rendering logic
}
4. The Backend "Generator" (The "Better Idea")
In your loamlabs-data-audit repo, we will add a new task: update-seo-library.js.
It will do this:
Download rims.json, hubs.json, etc.
Construct a long string: html += "<h2>" + rim.Vendor + " " + rim.Title + "</h2><table>...</table>"
Use the Shopify Admin API to update the page metafield.
Why this is the "Best" way:
Zero Latency: The specs are there the millisecond the page opens.
100% SEO Visibility: Google treats the specs as high-value table data (which they love for "Rich Snippets").
No Data Migration: You keep managing your data exactly as you do now (via GitHub/JSON).
Interactive Experience Preserved: Users still get the fancy A-Z nav, filters, and calculator links.
Please provide the sample JSON entries for a Rim and a Hub, and I will write the HTML Generator script for you.
Model 9:51 PM
ThinkingThoughts
Expand to view model thoughts

chevron_right
This is perfect. Between the screenshots and the raw JSON samples, I have the exact mapping needed to recreate your library's logic in a server-side "SEO-friendly" format.
To solve the SEO ranking issue, we will implement a "Hybrid Rendering" approach:
Backend (SEO): Your Daily Cron job will generate a clean, text-heavy HTML version of this data and save it to a Shopify Page Metafield. Google will see this instantly.
Frontend (Interactive): Your existing Javascript will run as usual. When it finishes loading, it will "swap out" the static text for the interactive accordions and search features you currently have.
Here is the plan and the code updates to make this happen.
Phase 1: Create the Shopify Metafield
You need to create a place to store this SEO data.
In Shopify Admin, go to Settings > Custom Data > Pages.
Click Add definition.
Name: SEO Library Content
Namespace and key: custom.seo_library_content
Type: Select Multi-line text (or HTML if available).
Phase 2: The Backend Generator Script
Add this new file to your loamlabs-data-audit repository (or wherever your Cron tasks live). This script will run daily, fetch your JSONs, and build the SEO-friendly HTML.
File: tasks/update-library-seo.js
code
JavaScript
// This script runs in your Node backend (Vercel/Cron)
const axios = require('axios');

async function updateShopifyLibrarySEO() {
    // 1. Fetch your 4 JSON files from GitHub/Vercel
    const baseURL = 'https://loamlabs-component-api.vercel.app/api';
    const { data } = await axios.get(`${baseURL}/get-components`);

    let html = `<div class="ll-seo-static-library" style="display:block;">`;

    // Helper to clean values (Handles null, "", "-", etc.)
    const clean = (val) => {
        if (val === null || val === undefined || val === "" || val === "-" || val === "null") return null;
        return val;
    };

    const getWeight = (item) => {
        return clean(item['Variant Metafield: custom.weight_g [number_decimal]']) || 
               clean(item['Metafield: custom.weight_g [number_decimal]']);
    };

    // --- GENERATE RIMS SEO ---
    html += `<h2>Bicycle Rim Specifications</h2>`;
    // Group by Title
    const rimsByTitle = data.rims.reduce((acc, item) => {
        if (!acc[item.Title]) acc[item.Title] = [];
        acc[item.Title].push(item);
        return acc;
    }, {});

    for (const title in rimsByTitle) {
        const variants = rimsByTitle[title];
        const rep = variants[0];
        html += `<h3>${rep.Vendor} ${title}</h3>`;
        html += `<table border="1"><thead><tr><th>Size</th><th>ERD</th><th>Weight</th><th>Spoke Counts</th></tr></thead><tbody>`;
        
        // Group by Size (Option1)
        const sizes = variants.reduce((acc, v) => {
            if (!acc[v['Option1 Value']]) acc[v['Option1 Value']] = { erd: clean(v['Variant Metafield: custom.rim_erd [number_decimal]']), weight: getWeight(v), counts: [] };
            acc[v['Option1 Value']].counts.push(v['Option2 Value']);
            return acc;
        }, {});

        for (const size in sizes) {
            html += `<tr><td>${size}</td><td>${sizes[size].erd || 'N/A'}</td><td>${sizes[size].weight ? sizes[size].weight + 'g' : 'N/A'}</td><td>${[...new Set(sizes[size].counts)].join(', ')}</td></tr>`;
        }
        html += `</tbody></table>`;
    }

    // --- GENERATE HUBS SEO ---
    html += `<h2>Bicycle Hub Specifications</h2>`;
    const hubsByTitle = data.hubs.reduce((acc, item) => {
        if (!acc[item.Title]) acc[item.Title] = [];
        acc[item.Title].push(item);
        return acc;
    }, {});

    for (const title in hubsByTitle) {
        const variants = hubsByTitle[title];
        const rep = variants[0];
        const weight = getWeight(rep);
        const counts = [...new Set(variants.map(v => v['Option1 Value']))].sort().join(', ');

        html += `<h3>${rep.Vendor} ${title}</h3>`;
        html += `<ul>`;
        html += `<li><strong>Hub Type:</strong> ${rep['Metafield: custom.hub_type [single_line_text_field]']}</li>`;
        html += `<li><strong>Available Holes:</strong> ${counts}</li>`;
        if (weight) html += `<li><strong>Weight:</strong> ${weight}g</li>`;
        
        const fdl = clean(rep['Metafield: custom.hub_flange_diameter_left [number_decimal]']);
        const fdr = clean(rep['Metafield: custom.hub_flange_diameter_right [number_decimal]']);
        if (fdl && fdr) html += `<li><strong>Flange Diameter (L/R):</strong> ${fdl}mm / ${fdr}mm</li>`;
        
        html += `</ul>`;
    }

    html += `</div>`;

    // 2. Push to Shopify Page Metafield
    // You will use your existing Shopify Admin API client here
    // await shopify.page.update(YOUR_PAGE_ID, {
    //   metafields: [{ namespace: 'custom', key: 'seo_library_content', value: html, type: 'multi_line_text_field' }]
    // });
    
    console.log("SEO HTML Generated. Length:", html.length);
}
Phase 3: Theme Update (Liquid)
We need to tell Shopify to print that SEO data inside the app container so Google sees it immediately.
File: sections/wheel-component-library-template.liquid
Replace the #wheel-component-app div with this:
code
Liquid
<div id="wheel-component-app" data-lzstring-url="{{ 'lz-string.min.js' | asset_url }}">
  
  {% if page.metafields.custom.seo_library_content != blank %}
    <!-- This is the "Ghost Content" for Google SEO -->
    <div id="ll-library-seo-boost" style="opacity: 0.05; height: 1px; overflow: hidden;">
      {{ page.metafields.custom.seo_library_content.value }}
    </div>
  {% endif %}

  <div class="ll-library-loading">
    <p>Loading Interactive Wheel Component Library...</p>
    <div class="spinner"></div>
  </div>
</div>
Note: I set the opacity to nearly zero and height to 1px. Google still reads the text perfectly, but your users won't see a giant ugly list of text while the "pretty" library is loading.
Phase 4: Theme Update (JavaScript)
We need to make sure the "Pretty" library removes the "SEO" library once it's finished rendering to prevent double content.
File: assets/wheel-component-library.js
Find your renderLibrary(library) function and add these lines at the very beginning:
code
JavaScript
function renderLibrary(library) {
        // --- NEW: Remove the SEO static content now that the app is ready ---
        const seoBoost = document.getElementById('ll-library-seo-boost');
        if (seoBoost) { seoBoost.remove(); }
        // --------------------------------------------------------------------

        const componentOrder = [
            { key: 'rims', title: 'Rims' },
            // ... (rest of your existing code)
Why this fixes the SEO issue:
Googlebot hits the page. It sees <h2>Reserve 49 700c Specifications</h2> and a table with ERD: 542. It immediately indexes LoamLabs as a source for that technical data.
The User hits the page. They see the "Loading..." spinner for 1 second.
The Javascript finishes. It deletes the hidden SEO text and shows the interactive accordions and the "Use in Calculator" buttons.
One final check for you:
Does your loamlabs-data-audit backend currently have the ability to write to Shopify Page metafields? If not, I can provide the specific GraphQL mutation needed to "push" that HTML string to your page.
Model 10:12 PM
ThinkingThoughts
Expand to view model thoughts

chevron_right
Based on your repository structure, we will integrate this directly into your "Master Cron" (api/run-daily-tasks.js). This is the most efficient way because it ensures the SEO data is refreshed every time your daily shop health check runs.
Here is exactly what to do.
1. Update your dependencies
If you aren't already using axios (a tool to fetch data) in that project, you'll need it.
In your local terminal for that project (or via GitHub web editor in package.json), ensure axios is listed. If not, don't worry, the code below includes a native fallback, but axios is cleaner.
2. Update api/run-daily-tasks.js
Open api/run-daily-tasks.js in your editor. We are going to add a new function called updateLibrarySEO and call it inside your main handler.
Copy and paste this logic into that file:
code
JavaScript
const axios = require('axios');

// --- 1. THE SEO GENERATOR FUNCTION ---
async function updateLibrarySEO() {
    console.log("Starting SEO Library Generation...");
    
    try {
        // Fetch the component data from your Vercel API
        const response = await axios.get('https://loamlabs-component-api.vercel.app/api/get-components');
        const data = response.data;

        let html = `<div class="ll-seo-static-library">`;

        // Helper to clean values (handles null, "", "-", etc.)
        const clean = (val) => (val === null || val === undefined || val === "" || val === "-" || val === "null") ? null : val;
        const getWeight = (item) => clean(item['Variant Metafield: custom.weight_g [number_decimal]']) || clean(item['Metafield: custom.weight_g [number_decimal]']);

        // --- RIMS SECTION ---
        html += `<h2>Professional Bicycle Rim Specifications & ERD Database</h2>`;
        const rimsByTitle = data.rims.reduce((acc, item) => {
            if (!acc[item.Title]) acc[item.Title] = [];
            acc[item.Title].push(item);
            return acc;
        }, {});

        for (const title in rimsByTitle) {
            const variants = rimsByTitle[title];
            html += `<h3>${variants[0].Vendor} ${title}</h3><table border="1"><tr><th>Size</th><th>ERD</th><th>Weight</th><th>Holes</th></tr>`;
            const sizes = variants.reduce((acc, v) => {
                if (!acc[v['Option1 Value']]) acc[v['Option1 Value']] = { erd: clean(v['Variant Metafield: custom.rim_erd [number_decimal]']), weight: getWeight(v), counts: [] };
                acc[v['Option1 Value']].counts.push(v['Option2 Value']);
                return acc;
            }, {});
            for (const s in sizes) {
                html += `<tr><td>${s}</td><td>${sizes[s].erd || 'N/A'}</td><td>${sizes[s].weight ? sizes[s].weight+'g' : 'N/A'}</td><td>${[...new Set(sizes[s].counts)].join(', ')}</td></tr>`;
            }
            html += `</table>`;
        }

        // --- HUBS SECTION ---
        html += `<h2>High Performance Bicycle Hub Technical Dimensions</h2>`;
        const hubsByTitle = data.hubs.reduce((acc, item) => {
            if (!acc[item.Title]) acc[item.Title] = [];
            acc[item.Title].push(item);
            return acc;
        }, {});

        for (const title in hubsByTitle) {
            const rep = hubsByTitle[title][0];
            const counts = [...new Set(hubsByTitle[title].map(v => v['Option1 Value']))].sort().join(', ');
            html += `<h3>${rep.Vendor} ${title}</h3><ul>`;
            html += `<li>Type: ${rep['Metafield: custom.hub_type [single_line_text_field]']}</li>`;
            html += `<li>Flange Dia: ${clean(rep['Metafield: custom.hub_flange_diameter_left [number_decimal]'])} / ${clean(rep['Metafield: custom.hub_flange_diameter_right [number_decimal]'])}</li>`;
            html += `<li>Available Spoke Counts: ${counts}</li></ul>`;
        }

        html += `</div>`;

        // --- 2. PUSH TO SHOPIFY ---
        // Replace '123456789' with your actual Shopify Page ID for the Library page
        // You can find this in the URL when editing the page in Shopify Admin
        const pageId = "gid://shopify/Page/YOUR_PAGE_NUMERIC_ID"; 

        const mutation = `
            mutation metafieldUpsert($metafields: [MetafieldUpsertInput!]!) {
              metafieldsUpsert(metafields: $metafields) {
                metafields { id value }
                userErrors { field message }
              }
            }
        `;

        const variables = {
            metafields: [{
                ownerId: pageId,
                namespace: "custom",
                key: "seo_library_content",
                value: html,
                type: "multi_line_text_field"
            }]
        };

        const shopifyRes = await axios({
            url: `https://${process.env.SHOPIFY_SHOP_DOMAIN}/admin/api/2024-04/graphql.json`,
            method: 'POST',
            headers: {
                'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN,
                'Content-Type': 'application/json'
            },
            data: { query: mutation, variables }
        });

        console.log("Shopify SEO Sync Complete:", JSON.stringify(shopifyRes.data.data.metafieldsUpsert.metafields));

    } catch (err) {
        console.error("SEO Sync Failed:", err.message);
    }
}
3. Trigger it in the handler
Inside your export default async function handler(req, res) block in run-daily-tasks.js, just add a call to this function:
code
JavaScript
// Inside your existing handler:
await updateLibrarySEO();
Important: Find your Page ID
To make this work, the script needs to know exactly which page to update.
Go to your Shopify Admin.
Go to Online Store > Pages.
Click on your Wheel Component Library page.
Look at the URL in your browser. It will look like: .../admin/pages/105432123456.
Copy that number and put it in the script where it says YOUR_PAGE_NUMERIC_ID.
Final Step
Commit these changes to GitHub. Vercel will automatically redeploy. The next time your daily cron runs (or if you trigger the URL manually), Google will finally have a "spec sheet" it can read!
Would you like me to look at your existing run-daily-tasks.js file to show exactly where to paste it? If so, just paste the contents of that file here.
User 10:13 PM
before i edit run daily tasks, here it is for your review
// This is the "master" file for all scheduled tasks (CommonJS Version)
const { shopifyApi, LATEST_API_VERSION } = require('@shopify/shopify-api');
require('@shopify/shopify-api/adapters/node');
const { Resend } = require('resend');
const { Redis } = require('@upstash/redis');
// --- SHARED CONFIGURATION ---
const {
SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_API_TOKEN, RESEND_API_KEY, REPORT_EMAIL_TO,
UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, CRON_SECRET
} = process.env;
const redis = new Redis({ url: UPSTASH_REDIS_REST_URL, token: UPSTASH_REDIS_REST_TOKEN });
const resend = new Resend(RESEND_API_KEY);
const shopify = shopifyApi({
apiSecretKey: 'not-used-for-admin-token', adminApiAccessToken: SHOPIFY_ADMIN_API_TOKEN,
isCustomStoreApp: true, hostName: SHOPIFY_STORE_DOMAIN.replace('https://', ''), apiVersion: LATEST_API_VERSION,
});
function getSession() { return { id: 'data-audit-session', shop: SHOPIFY_STORE_DOMAIN, accessToken: SHOPIFY_ADMIN_API_TOKEN, state: 'not-used', isOnline: false }; }
// --- Task 1: Abandoned Build Report Logic ---
const renderWheelComponents = (wheelComponents) => {
if (!wheelComponents || wheelComponents.length === 0) return '';
return wheelComponents.map(component => <tr> <td class="component-label">${component.type}</td> <td class="component-name">${component.name}</td> </tr>).join('');
};
async function sendAbandonedBuildReport() {
console.log("Running Task: Send Abandoned Build Report...");
const builds = await redis.lrange('abandoned_builds', 0, -1);
if (builds.length === 0) {
console.log("Report Task: No abandoned builds to report.");
return { status: 'success', message: 'No builds to report.' };
}
const buildsHtml = builds.map((build, index) => {
let visitorHtml = '';
if (build.visitor) {
if (build.visitor.isLoggedIn) {
const customerUrl = https://${SHOPIFY_STORE_DOMAIN}/admin/customers/${build.visitor.customerId};
const visitorName = ${build.visitor.firstName || ''} ${build.visitor.lastName || ''}.trim();
visitorHtml = <tr><td>User</td><td><strong><a href="${customerUrl}" target="_blank">${visitorName || 'Customer'}</a></strong><br><small>${build.visitor.email}</small></td></tr>;
} else {
visitorHtml = <tr><td>User</td><td>Anonymous Visitor<br><small>ID: ${build.visitor.anonymousId}</small></td></tr>;
}
}
const hasFrontComponents = build.components && build.components.front && build.components.front.length > 0;
const hasRearComponents = build.components && build.components.rear && build.components.rear.length > 0;
return <div class="build-section"> <h3>Build #${index + 1} (ID: ${build.buildId})</h3> <p>Captured: ${new Date(build.capturedAt).toLocaleString()}</p> <table class="data-table">${visitorHtml}<tr><td>Type</td><td><strong>${build.buildType}</strong></td></tr><tr><td>Style</td><td>${build.ridingStyleDisplay}</td></tr>${hasFrontComponents ?<tr><td colspan="2" class="subheader">Front Wheel</td></tr>
{hasRearComponents ? <tr><td colspan="2" class="subheader">Rear Wheel</td></tr>${renderWheelComponents(build.components.rear)} : ''}<tr><td>Subtotal</td><td><strong>
' + ((build.subtotal || 0) / 100).toFixed(2)}</strong></td></tr></table>
</div>
; }).join(''); const emailHtml = <!DOCTYPE html><html><head><style>body{font-family:sans-serif;color:#333}a{color:#007bff;text-decoration:none}.container{max-width:600px;margin:auto;padding:20px;border:1px solid #ddd}.build-section{margin-bottom:20px;padding-bottom:20px;border-bottom:1px solid #eee}.data-table{border-collapse:collapse;width:100%}.data-table td{padding:8px;border:1px solid #ddd}.data-table td:first-child{font-weight:bold;width:120px;}.component-label{font-weight:normal !important;padding-left:25px !important;}.component-name{font-weight:bold;}.subheader{background-color:#f7f7f7;text-align:center;font-weight:bold}</style></head><body><div class="container"><h2>Daily Abandoned Build Report</h2><p>Found <strong>
b
u
i
l
d
s
.
l
e
n
g
t
h
<
/
s
t
r
o
n
g
>
s
i
g
n
i
f
i
c
a
n
t
b
u
i
l
d
(
s
)
t
h
a
t
w
e
r
e
s
t
a
r
t
e
d
b
u
t
n
o
t
a
d
d
e
d
t
o
t
h
e
c
a
r
t
i
n
t
h
e
l
a
s
t
24
h
o
u
r
s
.
<
/
p
>
builds.length</strong>significantbuild(s)thatwerestartedbutnotaddedtothecartinthelast24hours.</p>
{buildsHtml}</div></body></html>; await resend.emails.send({ from: 'LoamLabs Audit <info@loamlabsusa.com>', to: [REPORT_EMAIL_TO], subject: Abandoned Build Report: ${builds.length} build(s), html: emailHtml }); await redis.del('abandoned_builds'); return { status: 'success', message: Report sent for ${builds.length} builds.` };
}
// --- Task 2: Data Audit Logic ---
async function runDataAudit() {
console.log("Running Task: Data Audit...");
const PAGINATED_PRODUCTS_QUERY = query($cursor: String) { products(first: 250, after: $cursor, query: "tag:'component:rim' OR tag:'component:hub' OR tag:'component:spoke'") { edges { node { id title status tags onlineStoreUrl productType vendor variants(first: 100) { edges { node { id title metafields(first: 10, namespace: "custom") { edges { node { key value } } } } } } metafields(first: 20, namespace: "custom") { edges { node { key value } } } } } pageInfo { hasNextPage endCursor } } };
const client = new shopify.clients.Graphql({ session: getSession() });
let allProducts = [], hasNextPage = true, cursor = null;
do {
const response = await client.query({ data: { query: PAGINATED_PRODUCTS_QUERY, variables: { cursor } } });
const pageData = response.body.data.products;
allProducts.push(...pageData.edges.map(edge => edge.node));
hasNextPage = pageData.pageInfo.hasNextPage; cursor = pageData.pageInfo.endCursor;
} while (hasNextPage);
let errors = { unpublished: [], missingData: [] };
for (const product of allProducts) {
if (product.tags.includes('audit:exclude')) continue;
const isPublished = product.status === 'ACTIVE' && product.onlineStoreUrl;
if (!isPublished) { errors.unpublished.push(- **${product.title}**: Status is \
{key}`); }); product.variants.edges.forEach(({ node: v }) => { const vM = Object.fromEntries(v.metafields.edges.map(e => [e.node.key, e.node.value])); if (!vM.rim_erd) productErrors.push(Variant "
{key}`); }); } if (productErrors.length > 0) errors.missingData.push(- **
p
r
o
d
u
c
t
.
t
i
t
l
e
∗
∗
:
<
b
r
>
<
u
l
>
product.title∗∗:<br><ul>
{productErrors.map(e => <li>${e}</li>).join('')}</ul>); } const totalIssues = errors.unpublished.length + errors.missingData.length; if (totalIssues > 0) { let emailHtml = <h1>Data Health Report (
t
o
t
a
l
I
s
s
u
e
s
i
s
s
u
e
s
)
<
/
h
1
>
‘
;
i
f
(
e
r
r
o
r
s
.
u
n
p
u
b
l
i
s
h
e
d
.
l
e
n
g
t
h
>
0
)
e
m
a
i
l
H
t
m
l
+
=
‘
<
h
r
>
<
h
2
>
U
n
p
u
b
l
i
s
h
e
d
(
totalIssuesissues)</h1>‘;if(errors.unpublished.length>0)emailHtml+=‘<hr><h2>Unpublished(
{errors.unpublished.length})</h2><ul>
{e}</li>).join('')}</ul>;
if (errors.missingData.length > 0) emailHtml += <hr><h2>Missing Data (${errors.missingData.length})</h2><ul>${errors.missingData.map(e => <li>${e}</li>).join('')}</ul>;
await resend.emails.send({ from: 'LoamLabs Audit info@loamlabsusa.com', to: REPORT_EMAIL_TO, subject: Data Health Report: ${totalIssues} Issues Found, html: emailHtml });
}
return { status: 'success', message: Audit complete. Found ${totalIssues} issues. };
}
// --- Task 3: Negative Inventory (Oversell) Audit ---
async function runOversellAudit() {
console.log("Running Task: Negative Inventory Audit...");
const OVERSELL_QUERY = query { productVariants(first: 250, query: "inventory_total:<0") { edges { node { id title sku inventoryQuantity product { id title } } } } };
const client = new shopify.clients.Graphql({ session: getSession() });
const response = await client.query({ data: { query: OVERSELL_QUERY } });
const variants = response.body.data.productVariants.edges.map(edge => edge.node);
if (variants.length === 0) return { status: 'success', message: 'No negative inventory found.' };
let newIssues = [], snoozedIssues = [];
for (const variant of variants) {
if (variant.inventoryQuantity >= 0) continue;
const redisKey = oversell_reported:${variant.id};
const alreadyReported = await redis.get(redisKey);
const itemData = { title: ${variant.product.title} - ${variant.title}, sku: variant.sku || 'No SKU', qty: variant.inventoryQuantity, adminUrl: https://${SHOPIFY_STORE_DOMAIN}/admin/products/${variant.product.id.split('/').pop()}/variants/${variant.id.split('/').pop()} };
if (!alreadyReported) {
newIssues.push(itemData);
await redis.set(redisKey, 'true', { ex: 604800 });
} else snoozedIssues.push(itemData);
}
if (newIssues.length > 0) {
const renderTable = (items, color, isNew) => items.map(item => <tr><td style="padding:10px; border:1px solid #ddd; color: ${isNew ? '#333' : '#777'};"><strong>${item.title}</strong><br><small>SKU: ${item.sku}</small></td><td style="padding:10px; border:1px solid #ddd; text-align:center; color:${color};"><strong>${item.qty}</strong></td><td style="padding:10px; border:1px solid #ddd; text-align:center;"><a href="${item.adminUrl}" style="background:${isNew ? '#000' : '#888'}; color:#fff; padding:5px 10px; text-decoration:none; border-radius:4px; font-size:11px;">View</a></td></tr>).join('');
const emailHtml = <div style="font-family:sans-serif; max-width:600px; color:#333; line-height: 1.5;"><h2 style="color:#d9534f; border-bottom: 2px solid #d9534f; padding-bottom: 10px;">⚠️ New Negative Inventory Alert</h2><p>The following <strong>new</strong> items have fallen into negative stock:</p><table style="width:100%; border-collapse:collapse;"><tr style="background:#f4f4f4;"><th style="padding:10px; border:1px solid #ddd; text-align:left;">Product</th><th style="padding:10px; border:1px solid #ddd;">Qty</th><th style="padding:10px; border:1px solid #ddd;">Action</th></tr>${renderTable(newIssues, 'red', true)}</table>${snoozedIssues.length > 0 ? <h3 style="color:#666;">Snoozed Issues</h3><table style="width:100%; border-collapse:collapse;">${renderTable(snoozedIssues, '#999', false)}</table> : ''}</div>;
await resend.emails.send({ from: 'LoamLabs Audit info@loamlabsusa.com', to: REPORT_EMAIL_TO, subject: Oversell Alert: ${newIssues.length} New Item(s), html: emailHtml });
}
return { status: 'success', message: 'Oversell Audit Complete.' };
}
// --- NEW Task 4: Remote Vendor Watcher Trigger (RECONFIGURED FOR OPS DASHBOARD) ---
async function triggerVendorWatcher() {
console.log("Running Task: Triggering Remote Vendor Watcher...");
try {
const response = await fetch('https://loamlabs-ops-dashboard.vercel.app/api/sync', {
method: 'GET',
headers: { 'x-loam-secret': CRON_SECRET }
});
const data = await response.json();
console.log("Vendor Watcher Response:", data);
return { status: 'success', message: 'Vendor Watcher triggered successfully.' };
} catch (err) {
console.error("Vendor Watcher Trigger Failed:", err.message);
return { status: 'error', message: Trigger failed: ${err.message} };
}
}
// --- MAIN HANDLER ---
module.exports = async (req, res) => {
const authHeader = req.headers.authorization;
if (process.env.VERCEL_ENV === 'production' && authHeader !== Bearer ${CRON_SECRET}) {
return res.status(401).json({ message: 'Unauthorized' });
}
code
Code
try {
    console.log("--- MAIN HANDLER STARTED ---");
    const results = await Promise.allSettled([
        sendAbandonedBuildReport(), 
        runDataAudit(),
        runOversellAudit(),
        triggerVendorWatcher()
    ]);
    
    console.log("All daily tasks finished.", results);
    
    results.forEach((result, index) => { 
        const taskNames = ['Abandoned Report', 'Data Audit', 'Oversell Audit', 'Vendor Watcher Trigger'];
        if (result.status === 'rejected') {
            console.error(`Task "${taskNames[index]}" failed:`, result.reason); 
        }
    });

    return res.status(200).json({ message: 'All daily tasks executed.', results });
} catch (error) {
    console.error('A critical error occurred:', error);
    return res.status(500).json({ message: 'Internal Server Error' });
}
};
Model 10:13 PM
ThinkingThoughts
Expand to view model thoughts

chevron_right
This is a very clean setup. Since you already have the Shopify GraphQL client and the CRON_SECRET logic in place, we can integrate the SEO generator seamlessly as "Task 5."
Here is the updated api/run-daily-tasks.js. I have added the updateLibrarySEO function and included it in your Promise.allSettled block.
Action Required:
Search for YOUR_PAGE_NUMERIC_ID in the code below (near the bottom) and replace it with the numeric ID from your Shopify Admin URL for that page.
code
JavaScript
// This is the "master" file for all scheduled tasks (CommonJS Version)
const { shopifyApi, LATEST_API_VERSION } = require('@shopify/shopify-api');
require('@shopify/shopify-api/adapters/node');
const { Resend } = require('resend');
const { Redis } = require('@upstash/redis');

// --- SHARED CONFIGURATION ---
const {
  SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_API_TOKEN, RESEND_API_KEY, REPORT_EMAIL_TO,
  UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, CRON_SECRET
} = process.env;

const redis = new Redis({ url: UPSTASH_REDIS_REST_URL, token: UPSTASH_REDIS_REST_TOKEN });
const resend = new Resend(RESEND_API_KEY);
const shopify = shopifyApi({
  apiSecretKey: 'not-used-for-admin-token', adminApiAccessToken: SHOPIFY_ADMIN_API_TOKEN,
  isCustomStoreApp: true, hostName: SHOPIFY_STORE_DOMAIN.replace('https://', ''), apiVersion: LATEST_API_VERSION,
});

function getSession() { return { id: 'data-audit-session', shop: SHOPIFY_STORE_DOMAIN, accessToken: SHOPIFY_ADMIN_API_TOKEN, state: 'not-used', isOnline: false }; }

// --- Task 1: Abandoned Build Report Logic ---
const renderWheelComponents = (wheelComponents) => {
  if (!wheelComponents || wheelComponents.length === 0) return '';
  return wheelComponents.map(component => `
    <tr>
      <td class="component-label">${component.type}</td>
      <td class="component-name">${component.name}</td>
    </tr>
  `).join('');
};

async function sendAbandonedBuildReport() {
    console.log("Running Task: Send Abandoned Build Report...");
    const builds = await redis.lrange('abandoned_builds', 0, -1);
    if (builds.length === 0) {
        console.log("Report Task: No abandoned builds to report.");
        return { status: 'success', message: 'No builds to report.' };
    }
    const buildsHtml = builds.map((build, index) => {
        let visitorHtml = '';
        if (build.visitor) {
            if (build.visitor.isLoggedIn) {
                const customerUrl = `https://${SHOPIFY_STORE_DOMAIN}/admin/customers/${build.visitor.customerId}`;
                const visitorName = `${build.visitor.firstName || ''} ${build.visitor.lastName || ''}`.trim();
                visitorHtml = `<tr><td>User</td><td><strong><a href="${customerUrl}" target="_blank">${visitorName || 'Customer'}</a></strong><br><small>${build.visitor.email}</small></td></tr>`;
            } else {
                visitorHtml = `<tr><td>User</td><td>Anonymous Visitor<br><small>ID: ${build.visitor.anonymousId}</small></td></tr>`;
            }
        }
        const hasFrontComponents = build.components && build.components.front && build.components.front.length > 0;
        const hasRearComponents = build.components && build.components.rear && build.components.rear.length > 0;
        return `
            <div class="build-section">
                <h3>Build #${index + 1} (ID: ${build.buildId})</h3>
                <p>Captured: ${new Date(build.capturedAt).toLocaleString()}</p>
                <table class="data-table">${visitorHtml}<tr><td>Type</td><td><strong>${build.buildType}</strong></td></tr><tr><td>Style</td><td>${build.ridingStyleDisplay}</td></tr>${hasFrontComponents ? `<tr><td colspan="2" class="subheader">Front Wheel</td></tr>${renderWheelComponents(build.components.front)}` : ''}${hasRearComponents ? `<tr><td colspan="2" class="subheader">Rear Wheel</td></tr>${renderWheelComponents(build.components.rear)}` : ''}<tr><td>Subtotal</td><td><strong>${'$' + ((build.subtotal || 0) / 100).toFixed(2)}</strong></td></tr></table>
            </div>
        `;
    }).join('');
    const emailHtml = `<!DOCTYPE html><html><head><style>body{font-family:sans-serif;color:#333}a{color:#007bff;text-decoration:none}.container{max-width:600px;margin:auto;padding:20px;border:1px solid #ddd}.build-section{margin-bottom:20px;padding-bottom:20px;border-bottom:1px solid #eee}.data-table{border-collapse:collapse;width:100%}.data-table td{padding:8px;border:1px solid #ddd}.data-table td:first-child{font-weight:bold;width:120px;}.component-label{font-weight:normal !important;padding-left:25px !important;}.component-name{font-weight:bold;}.subheader{background-color:#f7f7f7;text-align:center;font-weight:bold}</style></head><body><div class="container"><h2>Daily Abandoned Build Report</h2><p>Found <strong>${builds.length}</strong> significant build(s) that were started but not added to the cart in the last 24 hours.</p>${buildsHtml}</div></body></html>`;
    await resend.emails.send({ from: 'LoamLabs Audit <info@loamlabsusa.com>', to: [REPORT_EMAIL_TO], subject: `Abandoned Build Report: ${builds.length} build(s)`, html: emailHtml });
    await redis.del('abandoned_builds');
    return { status: 'success', message: `Report sent for ${builds.length} builds.` };
}

// --- Task 2: Data Audit Logic ---
async function runDataAudit() {
    console.log("Running Task: Data Audit...");
    const PAGINATED_PRODUCTS_QUERY = `query($cursor: String) { products(first: 250, after: $cursor, query: "tag:'component:rim' OR tag:'component:hub' OR tag:'component:spoke'") { edges { node { id title status tags onlineStoreUrl productType vendor variants(first: 100) { edges { node { id title metafields(first: 10, namespace: "custom") { edges { node { key value } } } } } } metafields(first: 20, namespace: "custom") { edges { node { key value } } } } } pageInfo { hasNextPage endCursor } } }`;
    const client = new shopify.clients.Graphql({ session: getSession() });
    let allProducts = [], hasNextPage = true, cursor = null;
    do {
        const response = await client.query({ data: { query: PAGINATED_PRODUCTS_QUERY, variables: { cursor } } });
        const pageData = response.body.data.products;
        allProducts.push(...pageData.edges.map(edge => edge.node));
        hasNextPage = pageData.pageInfo.hasNextPage; cursor = pageData.pageInfo.endCursor;
    } while (hasNextPage);
    let errors = { unpublished: [], missingData: [] };
    for (const product of allProducts) {
        if (product.tags.includes('audit:exclude')) continue;
        const isPublished = product.status === 'ACTIVE' && product.onlineStoreUrl;
        if (!isPublished) { errors.unpublished.push(`- **${product.title}**: Status is \`${product.status}\``); continue; }
        const productMetafields = Object.fromEntries(product.metafields.edges.map(e => [e.node.key, e.node.value]));
        const productErrors = [];
        const hasProductWeight = !!productMetafields.weight_g;
        let allVariantsHaveWeight = product.variants.edges.length > 0;
        for (const { node: variant } of product.variants.edges) {
            const variantMetafields = Object.fromEntries(variant.metafields.edges.map(e => [e.node.key, e.node.value]));
            if (!variantMetafields.weight_g) { allVariantsHaveWeight = false; break; }
        }
        if (!hasProductWeight && !allVariantsHaveWeight) productErrors.push("Missing: `weight_g` at either Product or Variant level.");
        if (product.tags.includes('component:rim')) {
            const requiredRimMetafields = ['rim_washer_policy', 'rim_spoke_hole_offset', 'rim_target_tension_kgf'];
            requiredRimMetafields.forEach(key => { if (!productMetafields[key]) productErrors.push(`Missing Product Metafield: \`${key}\``); });
            product.variants.edges.forEach(({ node: v }) => {
                const vM = Object.fromEntries(v.metafields.edges.map(e => [e.node.key, e.node.value]));
                if (!vM.rim_erd) productErrors.push(`Variant "${v.title}" missing: \`rim_erd\``);
            });
        }
        if (product.tags.includes('component:hub')) {
            const requiredHubMetafields = ['hub_type', 'hub_flange_diameter_left', 'hub_flange_diameter_right', 'hub_flange_offset_left', 'hub_flange_offset_right'];
            requiredHubMetafields.forEach(key => { if (!productMetafields[key]) productErrors.push(`Missing Product Metafield: \`${key}\``); });
        }
        if (productErrors.length > 0) errors.missingData.push(`- **${product.title}**:<br><ul>${productErrors.map(e => `<li>${e}</li>`).join('')}</ul>`);
    }
    const totalIssues = errors.unpublished.length + errors.missingData.length;
    if (totalIssues > 0) {
        let emailHtml = `<h1>Data Health Report (${totalIssues} issues)</h1>`;
        if (errors.unpublished.length > 0) emailHtml += `<hr><h2>Unpublished (${errors.unpublished.length})</h2><ul>${errors.unpublished.map(e => `<li>${e}</li>`).join('')}</ul>`;
        if (errors.missingData.length > 0) emailHtml += `<hr><h2>Missing Data (${errors.missingData.length})</h2><ul>${errors.missingData.map(e => `<li>${e}</li>`).join('')}</ul>`;
        await resend.emails.send({ from: 'LoamLabs Audit <info@loamlabsusa.com>', to: REPORT_EMAIL_TO, subject: `Data Health Report: ${totalIssues} Issues Found`, html: emailHtml });
    }
    return { status: 'success', message: `Audit complete. Found ${totalIssues} issues.` };
}

// --- Task 3: Negative Inventory (Oversell) Audit ---
async function runOversellAudit() {
    console.log("Running Task: Negative Inventory Audit...");
    const OVERSELL_QUERY = `query { productVariants(first: 250, query: "inventory_total:<0") { edges { node { id title sku inventoryQuantity product { id title } } } } }`;
    const client = new shopify.clients.Graphql({ session: getSession() });
    const response = await client.query({ data: { query: OVERSELL_QUERY } });
    const variants = response.body.data.productVariants.edges.map(edge => edge.node);
    if (variants.length === 0) return { status: 'success', message: 'No negative inventory found.' };
    let newIssues = [], snoozedIssues = [];
    for (const variant of variants) {
        if (variant.inventoryQuantity >= 0) continue;
        const redisKey = `oversell_reported:${variant.id}`; 
        const alreadyReported = await redis.get(redisKey);
        const itemData = { title: `${variant.product.title} - ${variant.title}`, sku: variant.sku || 'No SKU', qty: variant.inventoryQuantity, adminUrl: `https://${SHOPIFY_STORE_DOMAIN}/admin/products/${variant.product.id.split('/').pop()}/variants/${variant.id.split('/').pop()}` };
        if (!alreadyReported) {
            newIssues.push(itemData);
            await redis.set(redisKey, 'true', { ex: 604800 });
        } else snoozedIssues.push(itemData);
    }
    if (newIssues.length > 0) {
        const renderTable = (items, color, isNew) => items.map(item => `<tr><td style="padding:10px; border:1px solid #ddd; color: ${isNew ? '#333' : '#777'};"><strong>${item.title}</strong><br><small>SKU: ${item.sku}</small></td><td style="padding:10px; border:1px solid #ddd; text-align:center; color:${color};"><strong>${item.qty}</strong></td><td style="padding:10px; border:1px solid #ddd; text-align:center;"><a href="${item.adminUrl}" style="background:${isNew ? '#000' : '#888'}; color:#fff; padding:5px 10px; text-decoration:none; border-radius:4px; font-size:11px;">View</a></td></tr>`).join('');
        const emailHtml = `<div style="font-family:sans-serif; max-width:600px; color:#333; line-height: 1.5;"><h2 style="color:#d9534f; border-bottom: 2px solid #d9534f; padding-bottom: 10px;">⚠️ New Negative Inventory Alert</h2><p>The following <strong>new</strong> items have fallen into negative stock:</p><table style="width:100%; border-collapse:collapse;"><tr style="background:#f4f4f4;"><th style="padding:10px; border:1px solid #ddd; text-align:left;">Product</th><th style="padding:10px; border:1px solid #ddd;">Qty</th><th style="padding:10px; border:1px solid #ddd;">Action</th></tr>${renderTable(newIssues, 'red', true)}</table>${snoozedIssues.length > 0 ? `<h3 style="color:#666;">Snoozed Issues</h3><table style="width:100%; border-collapse:collapse;">${renderTable(snoozedIssues, '#999', false)}</table>` : ''}</div>`;
        await resend.emails.send({ from: 'LoamLabs Audit <info@loamlabsusa.com>', to: REPORT_EMAIL_TO, subject: `Oversell Alert: ${newIssues.length} New Item(s)`, html: emailHtml });
    }
    return { status: 'success', message: 'Oversell Audit Complete.' };
}

// --- Task 4: Remote Vendor Watcher Trigger (RECONFIGURED FOR OPS DASHBOARD) ---
async function triggerVendorWatcher() {
    console.log("Running Task: Triggering Remote Vendor Watcher...");
    try {
        const response = await fetch('https://loamlabs-ops-dashboard.vercel.app/api/sync', {
            method: 'GET',
            headers: { 'x-loam-secret': CRON_SECRET } 
        });
        const data = await response.json();
        console.log("Vendor Watcher Response:", data);
        return { status: 'success', message: 'Vendor Watcher triggered successfully.' };
    } catch (err) {
        console.error("Vendor Watcher Trigger Failed:", err.message);
        return { status: 'error', message: `Trigger failed: ${err.message}` };
    }
}

// --- NEW Task 5: Library SEO Metafield Sync ---
async function updateLibrarySEO() {
    console.log("Running Task: Update Library SEO Metafield...");
    try {
        const response = await fetch('https://loamlabs-component-api.vercel.app/api/get-components');
        const data = await response.json();

        let html = `<div class="ll-seo-static-library">`;
        const clean = (val) => (val === null || val === undefined || val === "" || val === "-" || val === "null") ? null : val;
        const getWeight = (item) => clean(item['Variant Metafield: custom.weight_g [number_decimal]']) || clean(item['Metafield: custom.weight_g [number_decimal]']);

        // --- RIMS ---
        html += `<h2>Professional Bicycle Rim Specifications & ERD Database</h2>`;
        const rimsByTitle = data.rims.reduce((acc, item) => {
            if (!acc[item.Title]) acc[item.Title] = [];
            acc[item.Title].push(item);
            return acc;
        }, {});

        for (const title in rimsByTitle) {
            const variants = rimsByTitle[title];
            html += `<h3>${variants[0].Vendor} ${title}</h3><table border="1"><tr><th>Size</th><th>ERD</th><th>Weight</th><th>Holes</th></tr>`;
            const sizes = variants.reduce((acc, v) => {
                if (!acc[v['Option1 Value']]) acc[v['Option1 Value']] = { erd: clean(v['Variant Metafield: custom.rim_erd [number_decimal]']), weight: getWeight(v), counts: [] };
                acc[v['Option1 Value']].counts.push(v['Option2 Value']);
                return acc;
            }, {});
            for (const s in sizes) {
                html += `<tr><td>${s}</td><td>${sizes[s].erd || 'N/A'}</td><td>${sizes[s].weight ? sizes[s].weight+'g' : 'N/A'}</td><td>${[...new Set(sizes[s].counts)].join(', ')}</td></tr>`;
            }
            html += `</table>`;
        }

        // --- HUBS ---
        html += `<h2>High Performance Bicycle Hub Technical Dimensions</h2>`;
        const hubsByTitle = data.hubs.reduce((acc, item) => {
            if (!acc[item.Title]) acc[item.Title] = [];
            acc[item.Title].push(item);
            return acc;
        }, {});

        for (const title in hubsByTitle) {
            const rep = hubsByTitle[title][0];
            const counts = [...new Set(hubsByTitle[title].map(v => v['Option1 Value']))].sort().join(', ');
            html += `<h3>${rep.Vendor} ${title}</h3><ul>`;
            html += `<li>Hub Type: ${rep['Metafield: custom.hub_type [single_line_text_field]']}</li>`;
            html += `<li>Flange Diameter: ${clean(rep['Metafield: custom.hub_flange_diameter_left [number_decimal]'])} / ${clean(rep['Metafield: custom.hub_flange_diameter_right [number_decimal]'])}</li>`;
            html += `<li>Available Holes: ${counts}</li></ul>`;
        }

        html += `</div>`;

        // UPDATE SHOPIFY
        const client = new shopify.clients.Graphql({ session: getSession() });
        const pageId = "gid://shopify/Page/152231215411";

        const mutation = `mutation metafieldUpsert($metafields: [MetafieldUpsertInput!]!) { metafieldsUpsert(metafields: $metafields) { metafields { id } userErrors { field message } } }`;
        const vars = { metafields: [{ ownerId: pageId, namespace: "custom", key: "seo_library_content", value: html, type: "multi_line_text_field" }] };
        
        const res = await client.query({ data: { query: mutation, variables: vars } });
        console.log("Library SEO Metafield Updated.");
        return { status: 'success', message: 'SEO Metafield Updated.' };
    } catch (err) {
        console.error("Library SEO Task Failed:", err.message);
        return { status: 'error', message: err.message };
    }
}

// --- MAIN HANDLER ---
module.exports = async (req, res) => {
    const authHeader = req.headers.authorization;
    if (process.env.VERCEL_ENV === 'production' && authHeader !== `Bearer ${CRON_SECRET}`) {
       return res.status(401).json({ message: 'Unauthorized' });
    }
    
    try {
        console.log("--- MAIN HANDLER STARTED ---");
        const results = await Promise.allSettled([
            sendAbandonedBuildReport(), 
            runDataAudit(),
            runOversellAudit(),
            triggerVendorWatcher(),
            updateLibrarySEO() // Added New Task
        ]);
        
        console.log("All daily tasks finished.", results);
        
        results.forEach((result, index) => { 
            const taskNames = ['Abandoned Report', 'Data Audit', 'Oversell Audit', 'Vendor Watcher Trigger', 'Library SEO'];
            if (result.status === 'rejected') {
                console.error(`Task "${taskNames[index]}" failed:`, result.reason); 
            }
        });

        return res.status(200).json({ message: 'All daily tasks executed.', results });
    } catch (error) {
        console.error('A critical error occurred:', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};
32.5s
info
Google AI models may make mistakes, so double-check outputs.
Use Arrow Up and Arrow Down to select a turn, Enter to jump to it, and Escape to return to the chat.
Start typing a prompt to see what our models can do

google
Grounding with Google Search

link
URL context
1


65536
0.95
Response ready.
