"""Production Signal Lab API over signer-aware research candidates."""
from __future__ import annotations
from aiohttp import web
import signal_lab as base


def component(points, maximum, why):
    return {"points": round(points, 1), "max": maximum, "why": why}


async def api_tokens(request: web.Request):
    limit=min(max(int(request.query.get("limit","20")),1),100)
    rs=base.rows("""
      SELECT mint,observed_at,observed_block_time,stage,signal_score,
             signal_tier,model_state,evidence,expires_at
      FROM pump_live_signals_v2 WHERE expires_at>now()
      ORDER BY CASE signal_tier WHEN 'strong_candidate' THEN 0 WHEN 'candidate' THEN 1 WHEN 'watch' THEN 2 ELSE 3 END,
               signal_score DESC, observed_block_time DESC LIMIT %s
    """,(limit,))
    out=[]
    for r in rs:
        e=r.get("evidence") or {}
        buys=int(e.get("buys30") or e.get("buy_tx_30s") or 0); sells=int(e.get("sells30") or e.get("sell_tx_30s") or 0)
        buyers=int(e.get("buyers30") or e.get("buyers_30s") or 0); sellers=int(e.get("sellers30") or e.get("sellers_30s") or 0)
        imb=float(e.get("imb30") or e.get("signed_flow_imbalance_30s") or 0); burst=float(e.get("burst") or e.get("burst_ratio_30s_120s") or 0)
        largest=float(e.get("largest") or e.get("largest_user_flow_share_30s") or 0); failed=int(e.get("failed30") or e.get("failed_tx_30s") or 0)
        tier=str(r.get("signal_tier") or "watch")
        labels={"strong_candidate":"High-priority on-chain candidate","candidate":"On-chain candidate","watch":"Watch: evidence still thin","avoid":"Avoid / insufficient edge"}
        flow=max(0,min(35,17.5*(imb+1))); breadth=max(0,min(25,buyers/8*25)); accel=max(0,min(20,burst/4*20)); quality=max(0,min(20,20*(1-largest)-failed*2))
        out.append({"mint":r["mint"],"score":round(float(r.get("signal_score") or 0),2),"label":labels.get(tier,tier.replace('_',' ').title()),"stage":r.get("stage"),"signal_tier":tier,"model_state":r.get("model_state"),"observed_at":r["observed_at"].isoformat() if r.get("observed_at") else None,"expires_at":r["expires_at"].isoformat() if r.get("expires_at") else None,"components":{"Signed order flow":component(flow,35,f"{buys} signer buys vs {sells} signer sells; imbalance {imb:+.2f}"),"Independent breadth":component(breadth,25,f"{buyers} buying signers vs {sellers} selling signers in 30s"),"Arrival acceleration":component(accel,20,f"30s activity is {burst:.2f}x its 120s-equivalent rate"),"Concentration quality":component(quality,20,f"largest signer is {largest:.1%} of flow; {failed} failed tx")},"warning":"Live on-chain candidate, not yet a validated expected-return estimate. Forward outcomes accumulate separately so this can graduate to a calibrated model.","evidence":e})
    return web.json_response(out)


async def api_research_state(_: web.Request):
    latest=base.one("SELECT started_at,completed_at,watermark,observations_written,outcomes_written,live_signals_written,error FROM pump_research_runs_v2 ORDER BY started_at DESC LIMIT 1")
    counts=base.one("SELECT (SELECT count(*) FROM pump_research_observations_v2)::bigint observations,(SELECT count(*) FROM pump_research_outcomes_v2)::bigint outcomes,(SELECT count(*) FROM pump_live_signals_v2 WHERE expires_at>now())::bigint live_signals")
    for k in ("started_at","completed_at"):
        if latest.get(k): latest[k]=latest[k].isoformat()
    return web.json_response({**latest,**counts,"decision_state":"live-heuristic-forward-validation-accumulating"})


def make_app():
    app=web.Application(); app.router.add_get("/",base.index); app.router.add_get("/health",base.health); app.router.add_get("/api/overview",base.api_overview); app.router.add_get("/api/tokens",api_tokens); app.router.add_get("/api/wallets",base.api_wallets); app.router.add_get("/api/activity",base.api_activity); app.router.add_get("/api/evidence/{mint}",base.api_evidence); app.router.add_get("/api/research-state",api_research_state); return app


if __name__=="__main__": web.run_app(make_app(),host="0.0.0.0",port=base.PORT,access_log=None)
