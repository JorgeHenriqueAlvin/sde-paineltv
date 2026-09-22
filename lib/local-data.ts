export type LocalData={media:any[];tvs:any[];playlists:any[];schedules:any[]};
const KEY="tv-corporativa-data-v1";
export function loadLocalData():LocalData{try{return JSON.parse(localStorage.getItem(KEY)||"") as LocalData}catch{return{media:[],tvs:[],playlists:[],schedules:[]}}}
export function saveLocalData(data:LocalData){localStorage.setItem(KEY,JSON.stringify(data));window.dispatchEvent(new Event("tv-data-changed"))}
function db(){return new Promise<IDBDatabase>((resolve,reject)=>{const req=indexedDB.open("tv-corporativa-media",1);req.onupgradeneeded=()=>req.result.createObjectStore("files");req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
export async function saveMediaFile(id:number,file:File){const d=await db();await new Promise<void>((resolve,reject)=>{const tx=d.transaction("files","readwrite");tx.objectStore("files").put(file,id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)});d.close()}
export async function getMediaUrl(id:number){const d=await db();const blob=await new Promise<Blob|undefined>((resolve,reject)=>{const req=d.transaction("files").objectStore("files").get(id);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});d.close();return blob?URL.createObjectURL(blob):""}
export async function deleteMediaFile(id:number){const d=await db();await new Promise<void>((resolve,reject)=>{const tx=d.transaction("files","readwrite");tx.objectStore("files").delete(id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)});d.close()}
