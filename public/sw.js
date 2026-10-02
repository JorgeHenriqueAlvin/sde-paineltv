const SHELL_CACHE="sde-tv-shell-v1";
const MEDIA_CACHE="sde-tv-media-v1";
const SHELL=["/tv","/favicon.svg"];

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(SHELL_CACHE).then(cache=>cache.addAll(SHELL)).catch(()=>{}));
  self.skipWaiting();
});
self.addEventListener("activate",event=>{
  event.waitUntil(self.clients.claim());
});
self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET") return;
  const url=new URL(request.url);
  if(request.destination==="video"||request.destination==="image"){
    event.respondWith(caches.open(MEDIA_CACHE).then(async cache=>{
      const cached=await cache.match(request,{ignoreSearch:true});
      if(cached) return cached;
      try{
        const response=await fetch(request);
        if(response.ok) await cache.put(request,response.clone());
        return response;
      }catch(error){
        if(cached) return cached;
        throw error;
      }
    }));
    return;
  }
  if(request.mode==="navigate"&&url.pathname.startsWith("/tv")){
    event.respondWith(fetch(request).then(async response=>{
      const cache=await caches.open(SHELL_CACHE);
      if(response.ok) await cache.put("/tv",response.clone());
      return response;
    }).catch(async()=>{
      const cache=await caches.open(SHELL_CACHE);
      return (await cache.match("/tv"))||Response.error();
    }));
  }
});