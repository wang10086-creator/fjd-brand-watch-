// Recognize compact access interstitials, not incidental account links on real product pages.
export function accessGate(page){
 const text=String(page?.text||'').replace(/\s+/g,' ').trim();if(!text||text.length>2500)return false;
 return /para continuar[,!]?\s+acesse\s+sua conta/i.test(text)||/para continuar[,!]?\s+(?:ingresa|inicia sesi[oó]n|accede)\s+(?:a |en )?tu cuenta/i.test(text)||/(?:sign in|log in) to continue|please (?:sign in|log in) to (?:continue|view)/i.test(text)||/(?:请先登录|登录后继续|登录后查看|請先登入|登入後繼續)/.test(text);
}
