defmodule HugeUploadWeb.PageController do
  use HugeUploadWeb, :controller

  def index(conn, _params) do
    render(conn, "index.html")
  end
end
