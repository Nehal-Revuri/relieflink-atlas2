from __future__ import annotations

import json
import sys
from types import SimpleNamespace
from unittest.mock import Mock

from vision_agent import agent


def _response(text: str):
    return SimpleNamespace(content=[SimpleNamespace(type="text", text=text)])


def test_claude_count_uses_two_stage_flow_and_post_counts(monkeypatch, tmp_path):
    image = tmp_path / "box.jpg"
    image.write_bytes(b"not-real-image-but-the-client-is-mocked")
    first_json = {
        "counts": {category: (10 if category == "canned_goods" else 0) for category in agent.CATEGORIES},
        "confidence": 0.99,
        "notes": "Two partially occluded cans are uncertain.",
    }
    second_json = {
        "counts": {category: (12 if category == "canned_goods" else 0) for category in agent.CATEGORIES},
        "confidence": 0.99,
        "notes": "A second pass found two more rims.",
    }
    responses = iter(
        [
            _response("Left to right: ten canned goods, including two partial rims."),
            _response(json.dumps(first_json)),
            _response("Independent recount: twelve canned goods, two identified by visible edges."),
            _response(json.dumps(second_json)),
        ]
    )
    client = SimpleNamespace(messages=SimpleNamespace(create=Mock(side_effect=lambda **_: next(responses))))
    monkeypatch.setitem(sys.modules, "anthropic", SimpleNamespace(Anthropic=lambda: client))

    result = agent.count_with_claude(str(image))

    assert set(result) == {"counts", "confidence", "notes"}
    assert set(result["counts"]) == set(agent.CATEGORIES)
    assert result["counts"]["canned_goods"] == 11
    assert 0 < result["confidence"] < 1
    assert "disagreement" in result["notes"]
    assert client.messages.create.call_count == 4

    post = Mock()
    post.return_value.raise_for_status.return_value = None
    monkeypatch.setattr(agent.requests, "post", post)
    agent.post_counts(1, result, source="vision")
    assert post.call_count == len(agent.CATEGORIES)
    assert {call.kwargs["json"]["category"] for call in post.call_args_list} == set(agent.CATEGORIES)
