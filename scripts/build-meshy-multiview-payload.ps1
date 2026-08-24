param(
    [Parameter(Mandatory = $true)]
    [string]$ConceptDirectory,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

$resolvedConceptDirectory = Resolve-Path -LiteralPath $ConceptDirectory
$viewNames = @('front.png', 'right.png', 'back.png', 'left.png')
$imageUrls = foreach ($viewName in $viewNames) {
    $viewPath = Join-Path $resolvedConceptDirectory $viewName
    $bytes = [IO.File]::ReadAllBytes($viewPath)
    'data:image/png;base64,' + [Convert]::ToBase64String($bytes)
}

$payload = [ordered]@{
    image_urls = $imageUrls
    ai_model = 'latest'
    should_texture = $false
    should_remesh = $false
    multi_view_thumbnails = $true
    target_formats = @('glb')
}

$json = $payload | ConvertTo-Json -Depth 5 -Compress
[IO.File]::WriteAllText($OutputPath, $json, [Text.UTF8Encoding]::new($false))
