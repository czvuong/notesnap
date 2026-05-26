"""
routers/costs.py — GET /api/costs, GET /api/costs/summary

Read-only endpoints for inspecting LLM API cost logs.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from models import CostLog
from schemas import CostLogOut, CostModelBreakdown, CostSummaryOut

router = APIRouter(prefix="/api/costs", tags=["costs"])


@router.get("", response_model=list[CostLogOut])
def list_cost_logs(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """
    Return recent cost-log entries, newest first.

    Use ?limit= and ?offset= for pagination.
    """
    rows = (
        db.query(CostLog)
        .order_by(CostLog.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [
        CostLogOut(
            id=r.id,
            model=r.model,
            operation=r.operation,
            prompt_tokens=r.prompt_tokens,
            completion_tokens=r.completion_tokens,
            estimated_cost_usd=r.estimated_cost_usd,
            created_at=r.created_at,
        )
        for r in rows
    ]


@router.get("/summary", response_model=CostSummaryOut)
def cost_summary(db: Session = Depends(get_db)):
    """
    Return aggregate totals grouped by (model, operation), plus grand totals.

    estimated_cost_usd is None in the grand total if any individual call had
    an unknown rate (i.e. the total would be incomplete).
    """
    # Grand totals
    totals = db.query(
        func.count(CostLog.id).label("total_calls"),
        func.sum(CostLog.prompt_tokens).label("total_prompt_tokens"),
        func.sum(CostLog.completion_tokens).label("total_completion_tokens"),
        func.sum(CostLog.estimated_cost_usd).label("total_cost"),
    ).one()

    # Check if any row has a NULL estimated_cost_usd (unknown rate)
    has_unknown = (
        db.query(CostLog)
        .filter(CostLog.estimated_cost_usd == None)
        .first()
    ) is not None

    # Per-(model, operation) breakdown
    groups = db.query(
        CostLog.model,
        CostLog.operation,
        func.count(CostLog.id).label("calls"),
        func.sum(CostLog.prompt_tokens).label("prompt_tokens"),
        func.sum(CostLog.completion_tokens).label("completion_tokens"),
        func.sum(CostLog.estimated_cost_usd).label("cost"),
    ).group_by(CostLog.model, CostLog.operation).all()

    by_model_operation = [
        CostModelBreakdown(
            model=g.model,
            operation=g.operation,
            calls=g.calls,
            prompt_tokens=g.prompt_tokens or 0,
            completion_tokens=g.completion_tokens or 0,
            estimated_cost_usd=g.cost,
        )
        for g in groups
    ]

    return CostSummaryOut(
        total_calls=totals.total_calls or 0,
        total_prompt_tokens=totals.total_prompt_tokens or 0,
        total_completion_tokens=totals.total_completion_tokens or 0,
        total_estimated_cost_usd=None if has_unknown else totals.total_cost,
        by_model_operation=by_model_operation,
    )
