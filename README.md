# mcsrv-sdk
Widgets SDK based on MinecraftServers.ru monitoring API

This SDK allows you to easily embed widgets for minecraft server (cards, badges, banners, vote buttons, etc.) on your website without the need for sending unnecessary Query requests to your server

 Data fetching with caching (in-memory + localStorage)

 SWR (stale-while-revalidate) mode for background updates

 Light / Dark / System themes support

 skeletons, and multi-language support (RU + EN)


To use the SDK, you need an a Public API Token for your server.

You can get it on your server management page at https://minecraftservers.ru.

Описание работы API (RU): https://minecraftservers.ru/api

⚙️ Installation
Add this script to your website (preferably before the closing </body> tag):
```html
<script src="https://minecraftservers.ru/sdk/v1.1.2/msrv-sdk.min.js" async></script> (async / defer)
```

🧩 Usage Examples
Server card
```html
<div class="msrv-card"
     data-token="exampletoken"
     data-url-enabled
     data-dark-theme="auto">
</div>
```

Banner
```html
<div class="msrv-banner"
     data-token="exampletoken"
     data-lang="en">
</div>
```

Online badge
```html
<div class="msrv-badge"
     data-token="exampletoken"
     data-eager>
</div>
```

Vote block
```html
<div class="msrv-vote"
     data-token="exampletoken">
</div>
```

⚙️ Widget attributes
Attribute	Type / Example	- Description
data-token	abcdef12345 - API token for your server (required)
data-lang	ru / en -	Force widget language
data-dark-theme	light / dark / auto -	Theme mode
data-ttl	60000 -	Cache lifetime (ms)
data-swr	(no value) - Always revalidate even if cache is fresh
data-url-enabled	(no value) - Make widget clickable to server page
data-eager	(no value) - Load immediately without waiting for scroll
data-height 150 -	Custom skeleton height


🧠 Advanced (optional)
Global configuration is available via:
```js
window.MSRV.config = {
  swr: true // enable background revalidation globally
};
```

Manual fetch:
```js
MSRV.fetch("YOUR_API_TOKEN").then(console.log);
```
Min-height before load
```html
<style>
  [class^="msrv-"][data-token] { display:block; }
  .msrv-card[data-token]   { min-height:196px; }
  .msrv-banner[data-token] { min-height:120px; }
  .msrv-row[data-token]    { min-height:60px;  }
  .msrv-badge[data-token]  { min-height:32px;  }
  .msrv-vote[data-token]   { min-height:96px;  }
</style>
```
