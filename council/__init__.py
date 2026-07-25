"""council — multi-model council pattern for structured AI deliberation.

The council pattern runs several AI models in parallel on the same question,
optionally adds an anonymized peer-review stage, and synthesizes a final
answer by active selection rather than averaging.

Members (seats) are individual model callers. The included ``bedrock_member``
module provides seats backed by AWS Bedrock's Converse API.
"""

from council.bedrock_member import chat, ChatResult, MODELS

__all__ = ["chat", "ChatResult", "MODELS"]
