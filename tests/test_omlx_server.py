import base64
import unittest

from council.omlx_server import (
    _anonymous_answers,
    build_chat_payload,
    split_reasoning,
)


class OmlxServerUnitTests(unittest.TestCase):
    def test_split_reasoning_separates_explicit_and_inline_thinking(self):
        answer, thinking = split_reasoning(
            "<think>First pass</think>Final answer",
            "Server-side reasoning",
        )

        self.assertEqual(answer, "Final answer")
        self.assertEqual(thinking, "Server-side reasoning\n\nFirst pass")

    def test_split_reasoning_handles_unclosed_think_tag(self):
        answer, thinking = split_reasoning("<think>Private chain of thought")

        self.assertEqual(answer, "")
        self.assertEqual(thinking, "Private chain of thought")

    def test_build_chat_payload_supports_thinking_and_image_content(self):
        encoded = base64.b64encode(b"fake image").decode("ascii")
        payload = build_chat_payload(
            "Describe this image",
            "qwen-vl",
            thinking=True,
            thinking_budget=1024,
            image={"data_url": f"data:image/png;base64,{encoded}"},
        )

        self.assertTrue(payload["enable_thinking"])
        self.assertEqual(payload["thinking_budget"], 1024)
        user_content = payload["messages"][1]["content"]
        self.assertEqual(user_content[0], {"type": "text", "text": "Describe this image"})
        self.assertEqual(user_content[1]["type"], "image_url")

    def test_anonymous_answers_drop_model_identity_and_relabel_packets(self):
        anonymous = _anonymous_answers([
            {"answer": "first"},
            {"answer": "second"},
            {"answer": "third"},
        ])

        self.assertEqual([item["label"] for item in anonymous], ["A", "B", "C"])
        self.assertEqual({item["answer"] for item in anonymous}, {"first", "second", "third"})
        self.assertTrue(all(set(item) == {"label", "answer"} for item in anonymous))


if __name__ == "__main__":
    unittest.main()
